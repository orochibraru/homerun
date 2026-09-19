import { describe, expect, test } from "bun:test";
import {
	decryptSecret,
	encryptSecret,
} from "../../../src/lib/services/secrets";
import fixture from "../go/internal/secrets/testdata/parity.json" with {
	type: "json",
};

describe("secrets parity with internal/secrets (Go)", () => {
	test("decrypts what the Go worker encrypted", () => {
		expect(decryptSecret(fixture.fromGo, fixture.authSecret)).toBe(
			fixture.plaintext,
		);
	});

	test("decrypts its own fixture, which the Go test decrypts too", () => {
		expect(decryptSecret(fixture.fromTs, fixture.authSecret)).toBe(
			fixture.plaintext,
		);
	});

	test("produces the three-part iv.tag.ciphertext shape Go parses", () => {
		const sealed = encryptSecret(fixture.plaintext, fixture.authSecret);
		const [iv, tag] = sealed.split(".");
		expect(sealed.split(".")).toHaveLength(3);
		expect(Buffer.from(iv, "base64")).toHaveLength(12);
		expect(Buffer.from(tag, "base64")).toHaveLength(16);
		expect(decryptSecret(sealed, "a-different-secret")).toBeNull();
	});
});
