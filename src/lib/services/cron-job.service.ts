import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { parseCommand } from "$lib/command-parse";
import type { CronJobDTO } from "$lib/dto/cron-job-dto";
import { CronJobRunDTO } from "$lib/dto/cron-job-run-dto";
import { Logger } from "$lib/logger";
import { DockerService, type RegistryAuth } from "./docker.service.ts";
import { decryptSecret } from "./secrets.ts";

const logger = new Logger("CronJob");
const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 1024 * 1024;
const CRON_JOB_LABEL = "homerun.cronjob.id";

export interface CronJobRunOutcome {
	error: string | null;
	exitCode: number | null;
	output: string;
	success: boolean;
}

interface ExecError {
	code?: number;
	killed?: boolean;
	stderr?: string;
	stdout?: string;
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

class CronJobServiceClass {
	async #runImage(job: CronJobDTO): Promise<CronJobRunOutcome> {
		if (!job.image) {
			return {
				error: "No image set on this cron job.",
				exitCode: null,
				output: "",
				success: false,
			};
		}

		const cmd = job.command ? parseCommand(job.command) : undefined;
		const result = await DockerService.runOneOff({
			auth: authFor(job),
			cmd: cmd && cmd.length > 0 ? cmd : undefined,
			envVars: job.envVars,
			image: job.image,
			labels: { [CRON_JOB_LABEL]: job.id },
			tag: job.tag ?? "latest",
			timeoutMs: job.timeoutSeconds * 1000,
		});

		const output = [
			result.stdout.toString("utf8"),
			result.stderr.toString("utf8"),
		]
			.filter(Boolean)
			.join("");

		return {
			error: result.timedOut
				? `Timed out after ${job.timeoutSeconds}s.`
				: result.exitCode === 0
					? null
					: `Exited with code ${result.exitCode}.`,
			exitCode: result.exitCode,
			output,
			success: result.exitCode === 0 && !result.timedOut,
		};
	}

	async #runExec(job: CronJobDTO): Promise<CronJobRunOutcome> {
		if (!job.command) {
			return {
				error: "No command set on this cron job.",
				exitCode: null,
				output: "",
				success: false,
			};
		}

		try {
			const { stdout, stderr } = await execFileAsync(
				"/bin/sh",
				["-c", job.command],
				{
					env: { ...process.env, ...job.envVars },
					maxBuffer: MAX_OUTPUT_BYTES,
					timeout: job.timeoutSeconds * 1000,
				},
			);
			return {
				error: null,
				exitCode: 0,
				output: `${stdout}${stderr}`,
				success: true,
			};
		} catch (err) {
			const failure = err as ExecError & Error;
			return {
				error: failure.killed
					? `Timed out after ${job.timeoutSeconds}s.`
					: failure.message,
				exitCode: failure.code ?? null,
				output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
				success: false,
			};
		}
	}

	async runJob(job: CronJobDTO): Promise<CronJobRunOutcome> {
		const run = await CronJobRunDTO.create(job.id);
		logger.info(`Cron job started: job=${job.id} kind=${job.kind}`);

		let outcome: CronJobRunOutcome;
		try {
			outcome =
				job.kind === "image"
					? await this.#runImage(job)
					: await this.#runExec(job);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`Cron job failed: job=${job.id}`, err);
			outcome = { error: message, exitCode: null, output: "", success: false };
		}

		await run.finish(outcome);
		await job.update({ lastRunAt: new Date() });
		logger.info(
			`Cron job finished: job=${job.id} success=${outcome.success} exit=${outcome.exitCode ?? "n/a"}`,
		);
		return outcome;
	}
}

export const CronJobService = new CronJobServiceClass();
