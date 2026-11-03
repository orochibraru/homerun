import {
	bucketAt,
	clampX,
	entryX,
	nearestPoint,
	pointerRatio,
	stepIndex,
} from "#lib/chart-hover.js";

/**
 * Which entry of a chart is under the pointer, the keyboard or a tap. Bars,
 * cells and strips pick the bucket the pointer is in; a line chart (`points`)
 * picks the nearest point. A mouse leaving clears it; a touch keeps it, so a
 * tapped bar stays readable until the chart loses focus.
 */
export class ChartHover {
	index = $state<number | null>(null);
	width = $state(0);
	readonly #count: () => number;
	readonly #points: boolean;

	/**
	 * @param count How many entries the chart currently draws.
	 * @param points Snap to evenly spaced points (line charts) instead of equal-width buckets.
	 */
	constructor(count: () => number, points = false) {
		this.#count = count;
		this.#points = points;
	}

	/** Highlights the entry under a pointer moving over, or pressing on, the chart's plot. */
	track = (event: PointerEvent): void => {
		const target = event.currentTarget as HTMLElement;
		const ratio = pointerRatio(event.clientX, target.getBoundingClientRect());
		this.index = this.#points
			? nearestPoint(ratio, this.#count())
			: bucketAt(ratio, this.#count());
	};

	/** Clears the highlight when a mouse leaves; a touch keeps it. */
	leave = (event: PointerEvent): void => {
		if (event.pointerType === "mouse") {
			this.index = null;
		}
	};

	/** Moves the highlight with the arrow, Home and End keys. */
	key = (event: KeyboardEvent): void => {
		const next = stepIndex(event.key, this.index, this.#count());
		if (next !== undefined) {
			event.preventDefault();
			this.index = next;
		}
	};

	/** Drops the highlight, e.g. once the chart loses focus. */
	clear = (): void => {
		this.index = null;
	};

	/** The tooltip's x, in pixels across the plot, for the highlighted entry; 0 when there's none. */
	get x(): number {
		if (this.index === null) {
			return 0;
		}
		return clampX(
			entryX(this.index, this.#count(), this.width, this.#points),
			this.width,
		);
	}
}
