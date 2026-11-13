import { GitRepoReconcileService } from "../git-repo-reconcile.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const TICK_MS = 60 * 60 * 1000;

/**
 * Every hour, checks where each repository Homerun builds from or watches
 * lives now on its provider, and follows it when its account, organization
 * or name changed (see `GitRepoReconcileService`).
 */
export class GitRepoReconcileScheduler extends BaseScheduler {
	protected readonly label = "GitRepoReconcile";

	protected readonly intervalMs = TICK_MS;

	/** Runs one reconcile pass. */
	protected async tick(): Promise<void> {
		await GitRepoReconcileService.reconcileAll();
	}
}
