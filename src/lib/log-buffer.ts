/** How many lines a live log panel keeps, shown or held while paused. */
export const MAX_LOG_LINES = 5000;

/** Appends `added` to `existing` as a new array, dropping the oldest entries past `limit`. */
export function appendCapped<T>(
	existing: T[],
	added: T[],
	limit: number = MAX_LOG_LINES,
): T[] {
	const merged = existing.concat(added);
	return merged.length > limit ? merged.slice(-limit) : merged;
}
