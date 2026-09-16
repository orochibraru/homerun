const SECOND_NS = 1_000_000_000;

/** Builds a container's `Healthcheck` spec from the service's configured healthcheck command, or undefined when none is set (no healthcheck attached). */
export function dockerHealthcheck(command: string | null | undefined) {
	const trimmed = command?.trim();
	if (!trimmed) {
		return;
	}
	return {
		Interval: 30 * SECOND_NS,
		Retries: 3,
		StartPeriod: 30 * SECOND_NS,
		Test: ["CMD-SHELL", trimmed],
		Timeout: 10 * SECOND_NS,
	};
}
