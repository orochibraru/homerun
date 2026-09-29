import { describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { generateSshKeyPair } from "$lib/server/ssh-keys";

describe("generateSshKeyPair", () => {
	test("writes an authorized_keys line whose key is the private key's public half", () => {
		const { privateKey, publicKey } = generateSshKeyPair("homerun");
		const [type, blob, comment] = publicKey.split(" ");
		expect(type).toBe("ssh-ed25519");
		expect(comment).toBe("homerun");

		const bytes = Buffer.from(blob ?? "", "base64");
		expect(bytes.readUInt32BE(0)).toBe(11);
		expect(bytes.subarray(4, 15).toString()).toBe("ssh-ed25519");
		expect(bytes.readUInt32BE(15)).toBe(32);
		const raw = bytes.subarray(19);
		expect(raw.length).toBe(32);

		const derived = createPublicKey(createPrivateKey(privateKey)).export({
			format: "jwk",
		});
		expect(Buffer.from(derived.x ?? "", "base64url").equals(raw)).toBe(true);
	});

	test("makes a new pair every time", () => {
		expect(generateSshKeyPair("a").publicKey).not.toBe(
			generateSshKeyPair("a").publicKey,
		);
	});
});
