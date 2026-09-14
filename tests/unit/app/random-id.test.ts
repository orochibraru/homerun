import { afterEach, describe, expect, test } from "bun:test";
import { randomId } from "../../../src/lib/random-id";

const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const original = crypto.randomUUID;

afterEach(() => {
	Object.defineProperty(crypto, "randomUUID", {
		configurable: true,
		value: original,
	});
});

describe("randomId", () => {
	test("uses crypto.randomUUID when it exists", () => {
		expect(randomId()).toMatch(UUID_V4);
	});

	test("still produces a distinct v4-shaped id without crypto.randomUUID", () => {
		Object.defineProperty(crypto, "randomUUID", {
			configurable: true,
			value: undefined,
		});
		const ids = new Set(Array.from({ length: 50 }, () => randomId()));
		expect(ids.size).toBe(50);
		for (const id of ids) {
			expect(id).toMatch(UUID_V4);
		}
	});
});
