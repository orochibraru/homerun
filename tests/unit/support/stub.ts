const restores: Array<() => void> = [];

/**
 * Replaces `target[key]` with `impl` until `restoreStubs()` runs, working on
 * both a real singleton and a partial `mock.module` stand-in another test file
 * may have registered (unlike `spyOn`, which misbehaves on a missing key).
 */
export function stub<T extends object>(
	target: T,
	key: string,
	impl: unknown,
): void {
	const record = target as Record<string, unknown>;
	const hadOwn = Object.hasOwn(record, key);
	const original = record[key];
	record[key] = impl;
	restores.push(() => {
		if (hadOwn) {
			record[key] = original;
		} else {
			delete record[key];
		}
	});
}

/** Undoes every `stub()` call, most recent first. */
export function restoreStubs(): void {
	while (restores.length > 0) {
		restores.pop()?.();
	}
}
