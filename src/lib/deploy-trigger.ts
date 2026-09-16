export const DEPLOY_TRIGGERS = ["manual", "cron", "push"] as const;

export type DeployTrigger = (typeof DEPLOY_TRIGGERS)[number];

/** How a deploy's trigger reads in a notification. */
export function deployTriggerLabel(trigger: DeployTrigger): string {
	return { cron: "Scheduled", manual: "Manual", push: "Git push" }[trigger];
}
