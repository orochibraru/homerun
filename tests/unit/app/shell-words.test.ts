import { describe, expect, test } from "bun:test";
import {
	argvFrom,
	joinShellWords,
	splitShellWords,
} from "../../../src/lib/shell-words";

describe("splitShellWords", () => {
	test("splits on whitespace", () => {
		expect(splitShellWords("  redis-server   --appendonly yes ")).toEqual([
			"redis-server",
			"--appendonly",
			"yes",
		]);
	});

	test("honours single quotes, double quotes and escapes", () => {
		expect(
			splitShellWords(`sh -c 'echo "hi there"' "a \\"b\\"" c\\ d ''`),
		).toEqual(["sh", "-c", 'echo "hi there"', 'a "b"', "c d", ""]);
	});

	test("an empty line has no words", () => {
		expect(splitShellWords("   ")).toEqual([]);
	});
});

describe("joinShellWords", () => {
	test("round-trips words that need quoting", () => {
		const words = ["sh", "-c", "echo 'it''s' $HOME", "", "plain=value"];
		expect(splitShellWords(joinShellWords(words))).toEqual(words);
		expect(joinShellWords(["redis-server", "--port", "6379"])).toBe(
			"redis-server --port 6379",
		);
	});
});

describe("argvFrom", () => {
	test("reads compose's string and list forms, null when empty", () => {
		expect(argvFrom("npm run start")).toEqual(["npm", "run", "start"]);
		expect(argvFrom(["./serve", 8080])).toEqual(["./serve", "8080"]);
		expect(argvFrom("")).toBeNull();
		expect(argvFrom([])).toBeNull();
		expect(argvFrom(undefined)).toBeNull();
	});
});
