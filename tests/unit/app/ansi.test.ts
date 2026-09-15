import { describe, expect, test } from "bun:test";

import { stripAnsi } from "../../../src/lib/ansi";

describe("stripAnsi", () => {
	test("drops the colour codes a container's healthcheck output carries", () => {
		expect(stripAnsi("\x1b[32mStatus: 200\x1b[0m Request took 0")).toBe(
			"Status: 200 Request took 0",
		);
	});

	test("leaves a line with no escapes untouched", () => {
		expect(stripAnsi("Healthcheck: healthy")).toBe("Healthcheck: healthy");
		expect(stripAnsi("")).toBe("");
	});
});
