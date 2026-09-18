import { parseCommand } from "$lib/command-parse";
import type { CronJobDTO } from "$lib/dto/cron-job-dto";
import { CronJobRunDTO } from "$lib/dto/cron-job-run-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import {
	HOST_COMMAND_IMAGE,
	HOST_COMMAND_TAG,
	hostCommandArgs,
} from "./docker/host-command.ts";
import { MANAGED_LABEL } from "./docker/labels.ts";
import {
	DockerService,
	type OneOffRunResult,
	type RegistryAuth,
} from "./docker.service.ts";
import { decryptSecret } from "./secrets.ts";

const logger = new Logger("CronJob");

const FLUSH_INTERVAL_MS = 1000;
const CRON_JOB_LABEL = "homerun.cronjob.id";

/** What the Go worker's cron_job executor runs, see `internal/jobs/cronjob`'s `Spec`. */
export interface CronJobRunSpec extends Record<string, unknown> {
	auth: RegistryAuth | null;
	cmd: string[] | null;
	env: string[];
	image: string;
	labels: Record<string, string>;
	pidMode: string | null;
	privileged: boolean;
	remote: {
		dockerHost: string;
		tlsCa: string | null;
		tlsCert: string | null;
		tlsKey: string | null;
	} | null;
	runId: string;
	timeoutSeconds: number;
}

/** What the Go executor reports for a finished run. */
export interface CronJobExecution {
	exitCode: number;
	output: string;
	timedOut: boolean;
}

export interface CronJobRunOutcome {
	error: string | null;
	exitCode: number | null;
	output: string;
	success: boolean;
}

function authFor(job: CronJobDTO): RegistryAuth | undefined {
	if (!job.registryUsername) {
		return;
	}
	return {
		password:
			(job.registryPasswordEnc
				? decryptSecret(job.registryPasswordEnc)
				: null) ?? "",
		serveraddress: job.registryUrl ?? undefined,
		username: job.registryUsername,
	};
}

/** Maps a finished one-off run onto a cron run outcome : success is a zero exit that didn't time out, and the output is stdout then stderr. */
function outcomeFrom(
	result: OneOffRunResult,
	timeoutSeconds: number,
): CronJobRunOutcome {
	return executionOutcome(
		{
			exitCode: result.exitCode,
			output: [result.stdout.toString("utf8"), result.stderr.toString("utf8")]
				.filter(Boolean)
				.join(""),
			timedOut: result.timedOut,
		},
		timeoutSeconds,
	);
}

/** Maps an executed run onto a cron run outcome : success is a zero exit that didn't time out. */
function executionOutcome(
	result: CronJobExecution,
	timeoutSeconds: number,
): CronJobRunOutcome {
	const { output } = result;
	return {
		error: result.timedOut
			? `Timed out after ${timeoutSeconds}s.`
			: result.exitCode === 0
				? null
				: `Exited with code ${result.exitCode}.`,
		exitCode: result.exitCode,
		output,
		success: result.exitCode === 0 && !result.timedOut,
	};
}

/** Batches the container's own output into the run row : one write a second at most, rather than one per chunk. */
class OutputFlusher {
	#buffer = "";
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly run: CronJobRunDTO) {}

	/** Appends `chunk` to the pending buffer, scheduling a flush in `FLUSH_INTERVAL_MS` if one isn't already scheduled. */
	push(chunk: string): void {
		this.#buffer += chunk;
		this.#timer ??= setTimeout(() => {
			this.#timer = null;
			void this.flush();
		}, FLUSH_INTERVAL_MS);
	}

	/** Writes the buffered output to the run row (`CronJobRunDTO.appendOutput`) and clears it, cancelling any pending scheduled flush. Logs and swallows a write failure rather than throwing. */
	async flush(): Promise<void> {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		const pending = this.#buffer;
		this.#buffer = "";
		await this.run.appendOutput(pending).catch((err) => {
			logger.warn("Couldn't append cron job output", err);
		});
	}
}

function envList(envVars: Record<string, string>): string[] {
	return Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
}

class CronJobServiceClass {
	/**
	 * Resolves what the Go worker runs for `job` : the image (or the privileged
	 * `nsenter` host-command helper), command, env, registry auth and, for an
	 * image job on a Docker-socket build server, its connection. Throws the
	 * same messages the in-process runner reported for a job with no image, no
	 * command, or an agent host.
	 */
	async #specFor(job: CronJobDTO, runId: string): Promise<CronJobRunSpec> {
		const labels = { [CRON_JOB_LABEL]: job.id, [MANAGED_LABEL]: "true" };
		const env = envList(job.envVars);
		if (job.kind !== "image") {
			if (!job.command) {
				throw new Error("No command set on this cron job.");
			}
			return {
				auth: null,
				cmd: hostCommandArgs(job.command),
				env,
				image: `${HOST_COMMAND_IMAGE}:${HOST_COMMAND_TAG}`,
				labels,
				pidMode: "host",
				privileged: true,
				remote: null,
				runId,
				timeoutSeconds: job.timeoutSeconds,
			};
		}
		if (!job.image) {
			throw new Error("No image set on this cron job.");
		}
		const target = await RemoteHostDTO.resolveBuildTarget(job.remoteHostId);
		if (target.kind === "agent") {
			throw new Error(
				"This cron job's host is a Homerun Agent, which has no one-off run endpoint : pick a Docker-socket host, or this one.",
			);
		}
		const cmd = job.command ? parseCommand(job.command) : [];
		return {
			auth: authFor(job) ?? null,
			cmd: cmd.length > 0 ? cmd : null,
			env,
			image: `${job.image}:${job.tag ?? "latest"}`,
			labels,
			pidMode: null,
			privileged: false,
			remote:
				target.kind === "docker"
					? {
							dockerHost: target.connection.dockerHost,
							tlsCa: target.connection.tlsCa ?? null,
							tlsCert: target.connection.tlsCert ?? null,
							tlsKey: target.connection.tlsKey ?? null,
						}
					: null,
			runId,
			timeoutSeconds: job.timeoutSeconds,
		};
	}

	/**
	 * Starts a run of `job` for the Go worker : records its `cron_job_run` row
	 * (which the worker streams output into) and returns the spec to execute.
	 * A job that can't run (no image, no command, an agent host) has its run
	 * finished as failed and `lastRunAt` stamped before this rethrows.
	 */
	async prepareRun(job: CronJobDTO): Promise<CronJobRunSpec> {
		const run = await CronJobRunDTO.create(job.id);
		logger.info(`Cron job started: job=${job.id} kind=${job.kind}`);
		try {
			return await this.#specFor(job, run.id);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			await this.#record(job, run, {
				error,
				exitCode: null,
				output: "",
				success: false,
			});
			throw err;
		}
	}

	/**
	 * Finishes the run `prepareRun` started with what the Go worker reported,
	 * `execution` or its `error`, and stamps `job.lastRunAt`. On an executor
	 * error the output already streamed into the run is kept.
	 */
	async finishRun(
		job: CronJobDTO,
		runId: string,
		execution: CronJobExecution | null,
		error: string | null,
	): Promise<CronJobRunOutcome> {
		const run = await CronJobRunDTO.get(runId);
		const outcome: CronJobRunOutcome = execution
			? executionOutcome(execution, job.timeoutSeconds)
			: {
					error: error ?? "The cron job's executor reported nothing.",
					exitCode: null,
					output: run?.output ?? "",
					success: false,
				};
		if (run) {
			await this.#record(job, run, outcome);
		} else {
			await job.update({ lastRunAt: new Date() });
		}
		return outcome;
	}

	/** Finishes `run` with `outcome`, stamps `job.lastRunAt` and logs the result. */
	async #record(
		job: CronJobDTO,
		run: CronJobRunDTO,
		outcome: CronJobRunOutcome,
	): Promise<void> {
		await run.finish(outcome);
		await job.update({ lastRunAt: new Date() });
		logger.info(
			`Cron job finished: job=${job.id} success=${outcome.success} exit=${outcome.exitCode ?? "n/a"}`,
		);
	}

	/**
	 * Runs an "image" kind cron job as a one-off container
	 * (`DockerService.runOneOff`) on its resolved host, streaming its output
	 * into `run` via an `OutputFlusher`. Fails fast with a descriptive
	 * outcome (rather than throwing) when the job has no image, or its host
	 * resolves to a Homerun Agent (no one-off run endpoint there).
	 */
	async #runImage(
		job: CronJobDTO,
		run: CronJobRunDTO,
	): Promise<CronJobRunOutcome> {
		if (!job.image) {
			return {
				error: "No image set on this cron job.",
				exitCode: null,
				output: "",
				success: false,
			};
		}

		const target = await RemoteHostDTO.resolveBuildTarget(job.remoteHostId);
		if (target.kind === "agent") {
			return {
				error:
					"This cron job's host is a Homerun Agent, which has no one-off run endpoint : pick a Docker-socket host, or this one.",
				exitCode: null,
				output: "",
				success: false,
			};
		}

		const cmd = job.command ? parseCommand(job.command) : undefined;
		const flusher = new OutputFlusher(run);
		const result = await DockerService.runOneOff({
			auth: authFor(job),
			cmd: cmd && cmd.length > 0 ? cmd : undefined,
			envVars: job.envVars,
			image: job.image,
			labels: { [CRON_JOB_LABEL]: job.id },
			onOutput: (chunk) => flusher.push(chunk),
			remote: target.kind === "docker" ? target.connection : null,
			tag: job.tag ?? "latest",
			timeoutMs: job.timeoutSeconds * 1000,
		});
		await flusher.flush();
		return outcomeFrom(result, job.timeoutSeconds);
	}

	/**
	 * Runs a "host command" (kind `exec`) cron job on the Docker host itself,
	 * not inside this app's container : a throwaway privileged `alpine`
	 * helper sharing the host's PID namespace `nsenter`s into PID 1 and runs
	 * the command through `sh -c` (`hostCommandArgs`). Only the job's own env
	 * vars reach the command, never this app's environment. Output streams
	 * into `run` as it arrives, and the helper is killed after
	 * `job.timeoutSeconds`. Never throws for a non-zero exit or a timeout,
	 * those are reported through the returned outcome.
	 */
	async #runExec(
		job: CronJobDTO,
		run: CronJobRunDTO,
	): Promise<CronJobRunOutcome> {
		if (!job.command) {
			return {
				error: "No command set on this cron job.",
				exitCode: null,
				output: "",
				success: false,
			};
		}

		const flusher = new OutputFlusher(run);
		const result = await DockerService.runOneOff({
			cmd: hostCommandArgs(job.command),
			envVars: job.envVars,
			image: HOST_COMMAND_IMAGE,
			labels: { [CRON_JOB_LABEL]: job.id },
			onOutput: (chunk) => flusher.push(chunk),
			pidMode: "host",
			privileged: true,
			tag: HOST_COMMAND_TAG,
			timeoutMs: job.timeoutSeconds * 1000,
		});
		await flusher.flush();
		return outcomeFrom(result, job.timeoutSeconds);
	}

	/**
	 * Runs `job` (dispatching to `#runImage` or `#runExec` by `job.kind`),
	 * recording a `cron_job_run` row for it and stamping `job.lastRunAt`
	 * regardless of outcome. Never throws: an unexpected error is captured
	 * into the returned outcome instead.
	 */
	async runJob(job: CronJobDTO): Promise<CronJobRunOutcome> {
		const run = await CronJobRunDTO.create(job.id);
		logger.info(`Cron job started: job=${job.id} kind=${job.kind}`);

		let outcome: CronJobRunOutcome;
		try {
			outcome =
				job.kind === "image"
					? await this.#runImage(job, run)
					: await this.#runExec(job, run);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Cron job failed: job=${job.id}`, err);
			outcome = { error: message, exitCode: null, output: "", success: false };
		}

		await this.#record(job, run, outcome);
		return outcome;
	}
}

export const CronJobService = new CronJobServiceClass();
