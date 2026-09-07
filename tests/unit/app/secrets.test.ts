import { describe, expect, test } from "bun:test";
import {
	decryptSecret,
	encryptSecret,
} from "../../../src/lib/services/secrets";

describe("encryptSecret / decryptSecret", () => {
	test("round-trips, including unicode and empty input", () => {
		for (const plaintext of ["hunter2", "", "pa ss@w/ord", "日本語 🔐"]) {
			expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
		}
	});

	test("uses a fresh IV, so the same plaintext never yields the same ciphertext", () => {
		expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
	});

	test("returns null rather than throwing on malformed input", () => {
		expect(decryptSecret("")).toBeNull();
		expect(decryptSecret("not-encrypted")).toBeNull();
		expect(decryptSecret("a.b")).toBeNull();
		expect(decryptSecret("a.b.c.d")).toBeNull();
		expect(decryptSecret("!!!.!!!.!!!")).toBeNull();
	});

	test("rejects a tampered ciphertext instead of returning wrong plaintext", () => {
		const [iv, tag, ciphertext] = encryptSecret("hunter2").split(".");
		const flipped = Buffer.from(ciphertext, "base64");
		flipped[0] ^= 0xff;
		expect(
			decryptSecret(`${iv}.${tag}.${flipped.toString("base64")}`),
		).toBeNull();
	});

	test("rejects a tampered auth tag", () => {
		const [iv, tag, ciphertext] = encryptSecret("hunter2").split(".");
		const flipped = Buffer.from(tag, "base64");
		flipped[0] ^= 0xff;
		expect(
			decryptSecret(`${iv}.${flipped.toString("base64")}.${ciphertext}`),
		).toBeNull();
	});
});
