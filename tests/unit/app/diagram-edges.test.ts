import { describe, expect, test } from "bun:test";
import { type Box, edgePaths } from "../../../src/lib/diagram-edges";

const box = (left: number, top: number): Box => ({
	bottom: top + 40,
	left,
	right: left + 100,
	top,
});

describe("edgePaths", () => {
	test("arrows sharing a side are spread along it in order", () => {
		const boxes = new Map([
			["server", box(100, 0)],
			["db", box(0, 100)],
			["redis", box(200, 100)],
		]);
		const [toDb, toRedis] = edgePaths(
			[
				{ from: "server", to: "redis" },
				{ from: "server", to: "db" },
			].reverse(),
			boxes,
		);
		expect(toDb?.d.startsWith("M 133.33333333333331 40 ")).toBe(true);
		expect(toDb?.d.endsWith(", 50 100")).toBe(true);
		expect(toRedis?.d.startsWith("M 166.66666666666666 40 ")).toBe(true);
	});

	test("an arrow to a card above leaves from the top", () => {
		const boxes = new Map([
			["stremthru", box(0, 200)],
			["server", box(0, 0)],
		]);
		const [edge] = edgePaths([{ from: "stremthru", to: "server" }], boxes);
		expect(edge?.d.startsWith("M 50 200 C 50 ")).toBe(true);
		expect(edge?.d.endsWith(", 50 40")).toBe(true);
	});

	test("cards on one row connect sideways, missing cards are dropped", () => {
		const boxes = new Map([
			["a", box(0, 0)],
			["b", box(300, 0)],
		]);
		const paths = edgePaths(
			[
				{ from: "b", to: "a" },
				{ from: "a", to: "gone" },
			],
			boxes,
		);
		expect(paths).toHaveLength(1);
		expect(paths[0]?.d.startsWith("M 300 20 C ")).toBe(true);
		expect(paths[0]?.d.endsWith(", 100 20")).toBe(true);
	});
});
