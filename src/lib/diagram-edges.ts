export interface Box {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

type Side = "bottom" | "left" | "right" | "top";

interface Anchor {
	edge: number;
	end: 0 | 1;
	toward: number;
}

const DIRECTION: Record<Side, [number, number]> = {
	bottom: [0, 1],
	left: [-1, 0],
	right: [1, 0],
	top: [0, -1],
};

/** The sides an edge from `a` to `b` leaves and enters through: the facing ones. */
function sides(a: Box, b: Box): [Side, Side] {
	if (b.top >= a.bottom) {
		return ["bottom", "top"];
	}
	if (b.bottom <= a.top) {
		return ["top", "bottom"];
	}
	return b.left >= a.right ? ["right", "left"] : ["left", "right"];
}

/** The point `fraction` of the way along `side` of `box`. */
function pointOn(box: Box, side: Side, fraction: number): [number, number] {
	if (side === "top" || side === "bottom") {
		return [
			box.left + (box.right - box.left) * fraction,
			side === "top" ? box.top : box.bottom,
		];
	}
	return [
		side === "left" ? box.left : box.right,
		box.top + (box.bottom - box.top) * fraction,
	];
}

/**
 * SVG paths for the arrows of a diagram: each edge leaves `from` and enters
 * `to` through their facing sides, and the edges sharing one side of a card
 * are spread along it, ordered by where their other end sits, so two arrows
 * never share a line and neighbours don't cross. Edges whose ends have no
 * box are dropped.
 */
export function edgePaths(
	edges: { from: string; to: string }[],
	boxes: Map<string, Box>,
): { d: string; from: string; key: string; to: string }[] {
	const drawn = edges.flatMap((edge) => {
		const a = boxes.get(edge.from);
		const b = boxes.get(edge.to);
		return a && b ? [{ ...edge, a, b, sides: sides(a, b) }] : [];
	});
	const groups = new Map<string, Anchor[]>();
	drawn.forEach((edge, i) => {
		for (const end of [0, 1] as const) {
			const other = end === 0 ? edge.b : edge.a;
			const side = edge.sides[end];
			const toward =
				side === "top" || side === "bottom"
					? (other.left + other.right) / 2
					: (other.top + other.bottom) / 2;
			const key = `${end === 0 ? edge.from : edge.to}:${side}`;
			groups.set(key, [...(groups.get(key) ?? []), { edge: i, end, toward }]);
		}
	});
	const points = new Map<string, [number, number]>();
	for (const anchors of groups.values()) {
		anchors.sort((x, y) => x.toward - y.toward);
		anchors.forEach((anchor, i) => {
			const edge = drawn[anchor.edge];
			if (edge) {
				points.set(
					`${anchor.edge}:${anchor.end}`,
					pointOn(
						anchor.end === 0 ? edge.a : edge.b,
						edge.sides[anchor.end],
						(i + 1) / (anchors.length + 1),
					),
				);
			}
		});
	}
	return drawn.map((edge, i) => {
		const [x1, y1] = points.get(`${i}:0`) ?? [0, 0];
		const [x2, y2] = points.get(`${i}:1`) ?? [0, 0];
		const bend = Math.max(24, Math.hypot(x2 - x1, y2 - y1) / 3);
		const [dx1, dy1] = DIRECTION[edge.sides[0]];
		const [dx2, dy2] = DIRECTION[edge.sides[1]];
		return {
			d: `M ${x1} ${y1} C ${x1 + dx1 * bend} ${y1 + dy1 * bend}, ${x2 + dx2 * bend} ${y2 + dy2 * bend}, ${x2} ${y2}`,
			from: edge.from,
			key: `${edge.from}>${edge.to}`,
			to: edge.to,
		};
	});
}
