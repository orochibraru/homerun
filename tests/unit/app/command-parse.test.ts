import { describe, expect, test } from "bun:test";
import { parseCommand } from "../../../src/lib/command-parse";

describe("parseCommand", () => {
	test("splits on whitespace", () => {
		expect(parseCommand("  pg_dump  -h db  app ")).toEqual([
			"pg_dump",
			"-h",
			"db",
			"app",
		]);
	});

	test("groups quoted arguments", () => {
		expect(parseCommand(`sh -c "echo hello world"`)).toEqual([
			"sh",
			"-c",
			"echo hello world",
		]);
		expect(parseCommand("echo 'it is fine'")).toEqual(["echo", "it is fine"]);
	});

	test("keeps an empty quoted argument", () => {
		expect(parseCommand('echo ""')).toEqual(["echo", ""]);
	});

	test("honours backslash escapes outside single quotes", () => {
		expect(parseCommand("echo a\\ b")).toEqual(["echo", "a b"]);
		expect(parseCommand("echo 'a\\ b'")).toEqual(["echo", "a\\ b"]);
	});

	test("takes a JSON array as exec form", () => {
		expect(parseCommand('["sh", "-c", "date +%s"]')).toEqual([
			"sh",
			"-c",
			"date +%s",
		]);
	});

	test("falls back to splitting when the JSON is malformed", () => {
		expect(parseCommand("[not json")).toEqual(["[not", "json"]);
	});

	test("returns nothing for blank input", () => {
		expect(parseCommand("   ")).toEqual([]);
	});
});
