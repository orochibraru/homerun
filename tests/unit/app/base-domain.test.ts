import { describe, expect, test } from "bun:test";
import { normalizeBaseDomain } from "../../../src/lib/server/validation/base-domain";

describe("normalizeBaseDomain", () => {
	test("keeps a plain hostname and reports no port", () => {
		expect(normalizeBaseDomain("example.com")).toEqual({
			domain: "example.com",
			port: null,
		});
	});

	test("splits a port off the routing domain rather than baking it in", () => {
		expect(normalizeBaseDomain("localhost:5173")).toEqual({
			domain: "localhost",
			port: "5173",
		});
	});

	test("forgives a pasted URL, keeping its port separate", () => {
		expect(normalizeBaseDomain("http://localhost:5173/")).toEqual({
			domain: "localhost",
			port: "5173",
		});
		expect(normalizeBaseDomain("https://app.example.com")).toEqual({
			domain: "app.example.com",
			port: null,
		});
	});

	test("forgives a trailing path and surrounding whitespace", () => {
		expect(normalizeBaseDomain("  example.com/foo  ")).toEqual({
			domain: "example.com",
			port: null,
		});
	});

	test("rejects a non-numeric or multi-colon host", () => {
		expect(normalizeBaseDomain("example.com:port")).toBeNull();
		expect(normalizeBaseDomain("example.com:1:2")).toBeNull();
	});

	test("rejects something that isn't a hostname at all", () => {
		expect(normalizeBaseDomain("")).toBeNull();
		expect(normalizeBaseDomain("not a host")).toBeNull();
		expect(normalizeBaseDomain("-bad.example.com")).toBeNull();
	});
});
