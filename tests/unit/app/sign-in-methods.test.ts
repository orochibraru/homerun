import { describe, expect, test } from "bun:test";
import { splitSignInMethods } from "$lib/sign-in-methods";

const available = ["password", "passkey", "oauth:github"];

describe("splitSignInMethods", () => {
	test("no preference shows everything up front", () => {
		expect(splitSignInMethods(available, [])).toEqual({
			others: [],
			primary: available,
		});
	});

	test("a preference keeps only it up front, in page order", () => {
		expect(splitSignInMethods(available, ["oauth:github", "passkey"])).toEqual({
			others: ["password"],
			primary: ["passkey", "oauth:github"],
		});
	});

	test("a preferred method that isn't available falls back to everything", () => {
		expect(splitSignInMethods(["password"], ["passkey"])).toEqual({
			others: [],
			primary: ["password"],
		});
	});
});
