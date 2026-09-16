import { config } from "$lib/config";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import {
	type CheckEvaluation,
	describeEvaluation,
	waitForChecks,
} from "$lib/status-checks";
import { NotificationChannelService } from "../notification-channel.service.ts";
import { statusChecksMessage } from "../notification-messages.ts";
import { StatusCheckService } from "../status-check.service.ts";
import type { GitSource } from "./plan.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

export const STATUS_CHECK_POLL_MS = 20_000;
export const STATUS_CHECK_TIMEOUT_MS = 30 * 60 * 1000;
export const STATUS_CHECK_GRACE_MS = 3 * 60 * 1000;

interface StatusCheckFailure {
	cancelled?: boolean;
	commit: string | null;
	evaluation: CheckEvaluation | null;
}

/**
 * Thrown when required git status checks block a git build from proceeding
 * (missing/unreadable checks, a timeout, a failing check, or the deploy
 * being cancelled while checks were still pending). Carries enough detail
 * (`commit`, `evaluation`, `cancelled`) for the caller to notify without
 * re-deriving it.
 */
export class StatusChecksFailedError extends Error {
	override name = "StatusChecksFailedError";
	readonly cancelled: boolean;
	readonly commit: string | null;
	readonly evaluation: CheckEvaluation | null;

	/** @param failure Carries the resolved commit and check evaluation so the caller can notify without re-deriving them. */
	constructor(message: string, failure: StatusCheckFailure) {
		super(message);
		this.cancelled = failure.cancelled ?? false;
		this.commit = failure.commit;
		this.evaluation = failure.evaluation;
	}
}

interface StatusCheckContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
	userId: string;
}

async function isCancelled(ctx: StatusCheckContext): Promise<boolean> {
	const [dep, svc] = await Promise.all([
		DeploymentDTO.get(ctx.dep.id),
		ServiceDTO.get(ctx.svc.id, ctx.svc.userId),
	]);
	const status = dep?.toJSON().status;
	return (
		!svc || status === undefined || status === "failed" || status === "stopped"
	);
}

/**
 * Blocks a git build until the service's required status checks all pass on
 * the ref's resolved commit, polling the git provider (`StatusCheckService`)
 * until they settle, time out, or the deploy is cancelled out from under
 * them. Appends progress to the deployment's log and records the resolved
 * commit onto the deployment row along the way.
 *
 * @returns The resolved commit sha the checks passed on, for the build step
 *   to actually check out.
 * @throws `StatusChecksFailedError` when no checks are configured, the
 *   checks can't be read, they fail, they time out, or the deploy is
 *   cancelled while waiting.
 */
export async function enforceStatusChecks(
	ctx: StatusCheckContext,
	git: GitSource,
): Promise<string> {
	const { dep, svc } = ctx;
	const required = svc.toJSON().requiredStatusChecks;
	const ref = git.gitRef || "main";
	if (required.length === 0) {
		throw new StatusChecksFailedError(
			"Status checks are required, but no checks are selected. Pick them on the Source tab.",
			{ commit: null, evaluation: null },
		);
	}

	let commit: string | null = null;
	try {
		const client = await StatusCheckService.clientFor(git.gitUrl, ctx.userId);
		commit = await client.resolveCommit(ref);
		await dep.appendLog(
			`Checking status checks on ${ref}@${commit.slice(0, 7)}: ${required.join(", ")}`,
		);
		await dep.update({ gitCommit: commit, gitRef: ref });
		const pinned = commit;
		const result = await waitForChecks({
			fetchChecks: () => client.checks(pinned),
			graceMs: STATUS_CHECK_GRACE_MS,
			isCancelled: () => isCancelled(ctx),
			log: (line) => dep.appendLog(line),
			pollMs: STATUS_CHECK_POLL_MS,
			required,
			timeoutMs: STATUS_CHECK_TIMEOUT_MS,
		});
		return await settle(ctx, result, pinned);
	} catch (err) {
		if (err instanceof StatusChecksFailedError) {
			throw err;
		}
		const reason = err instanceof Error ? err.message : String(err);
		logger.warn(`Status checks unreadable: service=${svc.id} : ${reason}`);
		throw new StatusChecksFailedError(
			`Couldn't read status checks: ${reason}. The build will not carry on.`,
			{ commit, evaluation: null },
		);
	}
}

/**
 * Turns a `waitForChecks` outcome into either the resolved commit (on pass)
 * or a `StatusChecksFailedError` describing why the build can't proceed.
 */
async function settle(
	ctx: StatusCheckContext,
	result: Awaited<ReturnType<typeof waitForChecks>>,
	commit: string,
): Promise<string> {
	const summary = describeEvaluation(result.evaluation);
	switch (result.outcome) {
		case "pass":
			await ctx.dep.appendLog(`Status checks passed (${summary}).`);
			logger.info(
				`Status checks passed: service=${ctx.svc.id} commit=${commit}`,
			);
			return commit;
		case "cancelled":
			throw new StatusChecksFailedError(
				"The deploy was cancelled while waiting for status checks.",
				{ cancelled: true, commit, evaluation: result.evaluation },
			);
		case "timeout":
			throw new StatusChecksFailedError(
				`Status checks didn't finish within ${STATUS_CHECK_TIMEOUT_MS / 60_000} minutes (${summary}). The build will not carry on.`,
				{ commit, evaluation: result.evaluation },
			);
		default:
			throw new StatusChecksFailedError(
				`Required status checks didn't pass (${summary}). The build will not carry on.`,
				{ commit, evaluation: result.evaluation },
			);
	}
}

/**
 * Notifies the user that a build was blocked by failing status checks : an
 * in-app `NotificationDTO` plus any configured notification channel. No-op
 * when the failure was because the deploy itself was cancelled, since that's
 * an intentional user action, not something to alert on.
 */
export async function notifyStatusChecksFailed(
	svc: ServiceDTO,
	userId: string,
	err: StatusChecksFailedError,
): Promise<void> {
	if (err.cancelled) {
		return;
	}
	const stack = svc.stackId ? await StackDTO.get(svc.stackId, userId) : null;
	NotificationDTO.notify({
		message: `"${svc.name}" was not built: ${err.message}`,
		serviceId: svc.id,
		type: "build_checks_failed",
		userId,
	});
	NotificationChannelService.notify(
		userId,
		statusChecksMessage(
			{
				commit: err.commit,
				failed: err.evaluation?.failed ?? [],
				missing: err.evaluation?.missing ?? [],
				origin: config.auth.origin ?? null,
				pending: err.evaluation?.pending ?? [],
				reason: err.message,
				service: svc.toJSON(),
				stackName: stack?.name ?? null,
			},
			new Date().toISOString(),
		),
	);
}
