import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";

import { parseAnsiLine, stripAnsi } from "../../../src/lib/ansi";

const ESC = "\x1b[";

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

describe("parseAnsiLine basics", () => {
	test("a plain line is one unstyled segment", () => {
		expect(parseAnsiLine("hello")).toEqual([{ className: "", text: "hello" }]);
	});

	test("colours text until a reset", () => {
		expect(parseAnsiLine(`${ESC}32mOK${ESC}0m done`)).toEqual([
			{ className: "text-green-400", text: "OK" },
			{ className: "", text: " done" },
		]);
	});

	test("an empty SGR is a reset", () => {
		expect(parseAnsiLine(`${ESC}1mbold${ESC}m plain`)).toEqual([
			{ className: "font-bold", text: "bold" },
			{ className: "", text: " plain" },
		]);
	});

	test("a line made only of escapes still yields one empty segment", () => {
		expect(parseAnsiLine(`${ESC}31m${ESC}0m`)).toEqual([
			{ className: "", text: "" },
		]);
	});

	test("the parser is re-entrant across calls", () => {
		const line = `${ESC}34mblue`;
		expect(parseAnsiLine(line)).toEqual(parseAnsiLine(line));
	});
});

describe("parseAnsiLine attributes", () => {
	test("stacks every attribute with a bright fg and bg", () => {
		const [segment] = parseAnsiLine(`${ESC}1;2;3;4;91;104mloud`);
		expect(segment).toEqual({
			className:
				"text-red-300 bg-blue-700 font-bold opacity-60 italic underline",
			text: "loud",
		});
	});

	test("turns each attribute back off individually", () => {
		const segments = parseAnsiLine(
			`${ESC}1;3;4;33;41ma${ESC}22mb${ESC}23mc${ESC}24md${ESC}39me${ESC}49mf`,
		);
		expect(segments.map((s) => s.className)).toEqual([
			"text-yellow-400 bg-red-900 font-bold italic underline",
			"text-yellow-400 bg-red-900 italic underline",
			"text-yellow-400 bg-red-900 underline",
			"text-yellow-400 bg-red-900",
			"bg-red-900",
			"",
		]);
	});

	test("ignores unknown codes", () => {
		expect(parseAnsiLine(`${ESC}5;7mx`)).toEqual([
			{ className: "", text: "x" },
		]);
	});
});

describe("parseAnsiLine extended colours", () => {
	test("skips a 256-colour code's parameters instead of misreading them", () => {
		expect(parseAnsiLine(`${ESC}38;5;1mx`)).toEqual([
			{ className: "", text: "x" },
		]);
	});

	test("skips a truecolour code's parameters, later codes still apply", () => {
		expect(parseAnsiLine(`${ESC}48;2;1;2;3;32mx`)).toEqual([
			{ className: "text-green-400", text: "x" },
		]);
	});

	test("a bare 38 with an unknown mode consumes nothing extra", () => {
		expect(parseAnsiLine(`${ESC}38;31mx`)).toEqual([
			{ className: "text-red-400", text: "x" },
		]);
	});
});

describe("AnsiLine", () => {
	test("renders each segment as a styled span with the escapes removed", async () => {
		const AnsiLine = (
			await import("../../../src/lib/components/ansi-line.svelte")
		).default;
		const { container, unmount } = render(AnsiLine, {
			line: `${ESC}31merror${ESC}0m: boom`,
		});
		const spans = [...container.querySelectorAll("span")];
		expect(spans.map((s) => s.textContent)).toEqual(["error", ": boom"]);
		expect(spans[0].className).toBe("text-red-400");
		expect(container.textContent).not.toContain("\x1b");
		unmount();
	});
});
