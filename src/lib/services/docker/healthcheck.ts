const SECOND_NS = 1_000_000_000;

export interface HealthcheckTiming {
	intervalSeconds?: number | null;
	retries?: number | null;
	startPeriodSeconds?: number | null;
	timeoutSeconds?: number | null;
}

export const HEALTHCHECK_DEFAULTS = {
	intervalSeconds: 30,
	retries: 3,
	startPeriodSeconds: 30,
	timeoutSeconds: 10,
} as const;

/** The service's healthcheck timing overrides, each falling back to `defaults` when unset. */
export function healthcheckTiming(
	timing: HealthcheckTiming,
	defaults: Required<{ [K in keyof HealthcheckTiming]: number }>,
) {
	return {
		Interval: (timing.intervalSeconds ?? defaults.intervalSeconds) * SECOND_NS,
		Retries: timing.retries ?? defaults.retries,
		StartPeriod:
			(timing.startPeriodSeconds ?? defaults.startPeriodSeconds) * SECOND_NS,
		Timeout: (timing.timeoutSeconds ?? defaults.timeoutSeconds) * SECOND_NS,
	};
}

/** Builds a container's `Healthcheck` spec from the service's configured healthcheck command and timing, or undefined when no command is set (no healthcheck attached). */
export function dockerHealthcheck(
	command: string | null | undefined,
	timing: HealthcheckTiming = {},
) {
	const trimmed = command?.trim();
	if (!trimmed) {
		return;
	}
	return {
		...healthcheckTiming(timing, HEALTHCHECK_DEFAULTS),
		StartInterval: SECOND_NS,
		Test: ["CMD-SHELL", trimmed],
	};
}

/** A service row's healthcheck timing overrides. */
export function healthcheckTimingOf(svc: {
	healthcheckIntervalSeconds: number | null;
	healthcheckRetries: number | null;
	healthcheckStartPeriodSeconds: number | null;
	healthcheckTimeoutSeconds: number | null;
}): HealthcheckTiming {
	return {
		intervalSeconds: svc.healthcheckIntervalSeconds,
		retries: svc.healthcheckRetries,
		startPeriodSeconds: svc.healthcheckStartPeriodSeconds,
		timeoutSeconds: svc.healthcheckTimeoutSeconds,
	};
}
