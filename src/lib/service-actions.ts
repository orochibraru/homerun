export type ServiceAction = "delete" | "restart" | "start" | "stop";

export const SERVICE_ACTION_LABELS: Record<
	ServiceAction,
	{ done: string; progressive: string; verb: string }
> = {
	delete: { done: "deleted", progressive: "Deleting", verb: "delete" },
	restart: { done: "restarted", progressive: "Restarting", verb: "restart" },
	start: { done: "started", progressive: "Starting", verb: "start" },
	stop: { done: "stopped", progressive: "Stopping", verb: "stop" },
};

/** "service" or "services" for `count`. */
export function plural(count: number): string {
	return count === 1 ? "service" : "services";
}
