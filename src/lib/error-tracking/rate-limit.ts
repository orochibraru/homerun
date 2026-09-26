/**
 * A fixed-window counter per key: at most `limit` hits per `windowMs`. Kept in
 * memory, so it resets on restart, which is fine for its only job of keeping
 * an error loop from flooding the database or the notification channels.
 */
export class WindowRateLimiter {
	readonly #limit: number;
	readonly #windowMs: number;
	readonly #windows = new Map<string, { count: number; start: number }>();

	constructor(limit: number, windowMs: number) {
		this.#limit = limit;
		this.#windowMs = windowMs;
	}

	/**
	 * Counts one hit for `key` at `now`. Returns null when it's allowed, else
	 * the whole seconds until the key's window resets.
	 */
	hit(key: string, now = Date.now()): number | null {
		const window = this.#windows.get(key);
		if (!window || now - window.start >= this.#windowMs) {
			if (this.#windows.size > 10_000) {
				this.#windows.clear();
			}
			this.#windows.set(key, { count: 1, start: now });
			return null;
		}
		if (window.count >= this.#limit) {
			return Math.max(
				1,
				Math.ceil((window.start + this.#windowMs - now) / 1000),
			);
		}
		window.count += 1;
		return null;
	}
}
