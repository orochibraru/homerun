export class Autofill {
	#filled = new Map<string, unknown>();
	#owned = new Set<string>();

	/**
	 * The value `field` takes now that detection found `detected`: the
	 * detected value while the field is blank (or at its default `blank`) or
	 * still holds the previous guess. Once the operator changes a guess, the
	 * field is theirs and detection never touches it again.
	 */
	pick<T>(
		field: string,
		current: T,
		detected: T | null | undefined,
		blank: T,
	): T {
		if (this.#filled.has(field) && current !== this.#filled.get(field)) {
			this.#owned.add(field);
		}
		if (
			this.#owned.has(field) ||
			detected === undefined ||
			detected === null ||
			detected === ""
		) {
			return current;
		}
		if (current !== blank && current !== "" && !this.#filled.has(field)) {
			this.#owned.add(field);
			return current;
		}
		this.#filled.set(field, detected);
		return detected;
	}

	/** Whether `field` still holds the value detection filled in. */
	holds(field: string, current: unknown): boolean {
		return this.#filled.has(field) && this.#filled.get(field) === current;
	}
}
