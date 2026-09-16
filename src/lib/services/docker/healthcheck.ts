const SECOND_NS = 1_000_000_000;

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
