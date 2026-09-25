const registry = globalThis as unknown as {
	__homerun_uptime_quiet_until?: number;
};

export const TRAEFIK_RESTART_QUIET_MS = 90_000;
export const BOOT_QUIET_MS = 90_000;

/**
 * Silences the uptime probe until `ms` from `now` (or longer, if a window is
 * already open), for a disruption Homerun causes on purpose: its own boot, a
 * Traefik recreate, a self-update. Every routed site blinks during those, and
 * recording that as outages sent a wall of "is down" alerts after each update.
 */
export function quietUptimeProbes(ms: number, now = Date.now()): void {
	registry.__homerun_uptime_quiet_until = Math.max(
		registry.__homerun_uptime_quiet_until ?? 0,
		now + ms,
	);
}

/** Ends any quiet window now, for an update that didn't go through after all. */
export function resumeUptimeProbes(): void {
	registry.__homerun_uptime_quiet_until = 0;
}

/** Whether the uptime probe is inside a quiet window. */
export function uptimeProbesQuiet(now = Date.now()): boolean {
	return (registry.__homerun_uptime_quiet_until ?? 0) > now;
}
