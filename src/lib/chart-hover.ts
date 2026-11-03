/** A pointer's horizontal position across `rect`, as a share from 0 to 1. */
export function pointerRatio(
	clientX: number,
	rect: { left: number; width: number },
): number {
	if (rect.width <= 0) {
		return 0;
	}
	return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
}

/** The bar or cell `ratio` falls in, out of `count` equal-width ones; null when there are none. */
export function bucketAt(ratio: number, count: number): number | null {
	if (count <= 0) {
		return null;
	}
	return Math.min(Math.floor(ratio * count), count - 1);
}

/** The evenly spaced point (first at 0, last at 1) nearest to `ratio`, out of `count`; null when there are none. */
export function nearestPoint(ratio: number, count: number): number | null {
	if (count <= 0) {
		return null;
	}
	return Math.round(ratio * (count - 1));
}

/**
 * The index an arrow, Home or End key moves a chart's highlight to, out of
 * `count` entries, starting from the first or last one when nothing is
 * highlighted yet; undefined for any other key, so the caller leaves it alone.
 */
export function stepIndex(
	key: string,
	index: number | null,
	count: number,
): number | undefined {
	if (count <= 0) {
		return undefined;
	}
	const last = count - 1;
	switch (key) {
		case "ArrowLeft":
		case "ArrowDown":
			return index === null ? last : Math.max(index - 1, 0);
		case "ArrowRight":
		case "ArrowUp":
			return index === null ? 0 : Math.min(index + 1, last);
		case "Home":
			return 0;
		case "End":
			return last;
		default:
			return undefined;
	}
}

/** Where entry `index` of `count` sits across `width` pixels: the centre of its bucket, or its point when `points` is set. */
export function entryX(
	index: number,
	count: number,
	width: number,
	points = false,
): number {
	if (count <= 0) {
		return 0;
	}
	if (points) {
		return count === 1 ? width / 2 : (index / (count - 1)) * width;
	}
	return ((index + 0.5) / count) * width;
}

/** `x` kept at least `margin` pixels inside `width`, so a centred tooltip doesn't hang off the chart; the middle when it's too narrow for that. */
export function clampX(x: number, width: number, margin = 72): number {
	if (width <= margin * 2) {
		return width / 2;
	}
	return Math.min(Math.max(x, margin), width - margin);
}

/** A time of day as the viewer's `HH:MM`. */
export function clockLabel(at: Date | number | string): string {
	return new Date(at).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}
