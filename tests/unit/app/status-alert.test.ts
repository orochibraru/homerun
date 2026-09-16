import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { detectTransitions } = await import(
	"../../../src/lib/services/status-alert.service"
);

function prior(entries: Array<[string, boolean]>) {
	return new Map(entries.map(([key, ok]) => [key, { ok }]));
}

describe("detectTransitions", () => {
	test("reports a probe that went from up to down, and back", () => {
		const previous = prior([
			["a:internal", true],
			["b:external", false],
		]);

		expect(
			detectTransitions(previous, [
				{
					detail: "Connection refused.",
					kind: "internal",
					ok: false,
					serviceId: "a",
				},
				{ detail: "HTTP 200", kind: "external", ok: true, serviceId: "b" },
			]),
		).toEqual([
			{
				detail: "Connection refused.",
				kind: "internal",
				ok: false,
				serviceId: "a",
			},
			{ detail: "HTTP 200", kind: "external", ok: true, serviceId: "b" },
		]);
	});

	test("a probe holding the same state is not a transition", () => {
		const previous = prior([
			["a:internal", true],
			["b:internal", false],
		]);

		expect(
			detectTransitions(previous, [
				{ kind: "internal", ok: true, serviceId: "a" },
				{ kind: "internal", ok: false, serviceId: "b" },
			]),
		).toEqual([]);
	});

	test("a first-ever beat is not a transition", () => {
		expect(
			detectTransitions(new Map(), [
				{ kind: "internal", ok: false, serviceId: "fresh" },
			]),
		).toEqual([]);
	});

	test("the two probes of one service are tracked separately", () => {
		const previous = prior([
			["a:internal", true],
			["a:external", true],
		]);

		expect(
			detectTransitions(previous, [
				{ kind: "internal", ok: true, serviceId: "a" },
				{ kind: "external", ok: false, serviceId: "a" },
			]),
		).toEqual([{ detail: null, kind: "external", ok: false, serviceId: "a" }]);
	});
});
