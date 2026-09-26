export const DEPLOY_TRIGGERS = ["manual", "cron", "push"] as const;

export type DeployTrigger = (typeof DEPLOY_TRIGGERS)[number];

/** How a deploy's trigger reads in a notification. */
export function deployTriggerLabel(trigger: DeployTrigger): string {
	return { cron: "Scheduled", manual: "Manual", push: "Git push" }[trigger];
}

export const HISTORY_TRIGGERS = [...DEPLOY_TRIGGERS, "rollback"] as const;

export type HistoryTrigger = (typeof HISTORY_TRIGGERS)[number];

/**
 * What started a deployment, for the history page: a rollback when it has a
 * rollback target, otherwise its recorded trigger, or null for a deployment
 * from before triggers were recorded.
 */
export function historyTrigger(
	rollbackOfDeploymentId: string | null,
	trigger: string | null,
): HistoryTrigger | null {
	if (rollbackOfDeploymentId) {
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
