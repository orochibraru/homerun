import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fail, printJson, printTable } from "../../cli/output";

describe("printTable", () => {
	afterEach(() => {
		mock.restore();
	});

	test("prints '(none)' for an empty row set", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		printTable([], ["id", "name"]);
		expect(logSpy).toHaveBeenCalledWith("(none)");
	});

	test("pads columns to the widest cell (including the header)", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		printTable(
			[
				{ id: "1", name: "short" },
				{ id: "2", name: "a-much-longer-name" },
			],
			["id", "name"],
		);
		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		expect(lines[0]).toBe("id  name              ");
		expect(lines[1]).toBe("--  ------------------");
		expect(lines[2]).toBe("1   short             ");
		expect(lines[3]).toBe("2   a-much-longer-name");
	});

	test("renders a missing/undefined cell as an empty string", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		printTable([{ id: "1" }], ["id", "name"]);
		const lines = logSpy.mock.calls.map((c) => c[0] as string);
		expect(lines[2]).toBe("1       ");
	});
});

describe("printJson", () => {
	test("pretty-prints with 2-space indentation", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		printJson({ a: 1, b: [1, 2] });
		expect(logSpy).toHaveBeenCalledWith(
			JSON.stringify({ a: 1, b: [1, 2] }, null, 2),
		);
		logSpy.mockRestore();
	});
});

describe("fail", () => {
	afterEach(() => {
		mock.restore();
	});

	test("prints an 'error: ' prefixed message to stderr and exits 1", () => {
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		const exitSpy = spyOn(process, "exit").mockImplementation(
			(() => undefined) as never,
		);

		fail("something broke");

		expect(errorSpy).toHaveBeenCalledWith("error: something broke");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
