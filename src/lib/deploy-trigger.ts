export const DEPLOY_TRIGGERS = ["manual", "cron", "push", "promote"] as const;

export type DeployTrigger = (typeof DEPLOY_TRIGGERS)[number];

/** How a deploy's trigger reads in a notification. */
export function deployTriggerLabel(trigger: DeployTrigger): string {
	return {
		cron: "Scheduled",
		manual: "Manual",
		promote: "Promote",
		push: "Git push",
	}[trigger];
}

export const HISTORY_TRIGGERS = [...DEPLOY_TRIGGERS, "rollback"] as const;

export type HistoryTrigger = (typeof HISTORY_TRIGGERS)[number];

/**
 * Whether a deployment row is a rollback: it points at a revision to redeploy
 * and wasn't a preview promote, which reuses that same pointer to name the
 * preview revision whose image it deploys.
 */
export function isRollback(
	rollbackOfDeploymentId: string | null,
	trigger: string | null,
): boolean {
	return Boolean(rollbackOfDeploymentId) && trigger !== "promote";
}

/**
 * What started a deployment, for the history page: a rollback when it has a
 * rollback target (a promote excepted), otherwise its recorded trigger, or
 * null for a deployment from before triggers were recorded.
 */
export function historyTrigger(
	rollbackOfDeploymentId: string | null,
	trigger: string | null,
): HistoryTrigger | null {
	if (isRollback(rollbackOfDeploymentId, trigger)) {
		return "rollback";
	}
	return (DEPLOY_TRIGGERS as readonly string[]).includes(trigger ?? "")
		? (trigger as DeployTrigger)
		: null;
}

/** How a history trigger reads on the deployment history page, "Deploy" when unknown. */
export function historyTriggerLabel(trigger: HistoryTrigger | null): string {
	if (trigger === "rollback") {
		return "Rollback";
	}
	return trigger ? deployTriggerLabel(trigger) : "Deploy";
}
