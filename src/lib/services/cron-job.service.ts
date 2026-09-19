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
import { type RegistryAuth } from "./docker.service.ts";
import { decryptSecret } from "./secrets.ts";

const logger = new Logger("CronJob");

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
}

export const CronJobService = new CronJobServiceClass();
