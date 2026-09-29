import { generateKeyPairSync } from "node:crypto";

/** A big-endian uint32 length prefix, as the SSH wire format writes strings. */
function lengthPrefixed(bytes: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length);
	return Buffer.concat([length, bytes]);
}

/**
 * A fresh ed25519 key pair for SSH: the private key as PKCS#8 PEM (what the
 * worker's SSH client reads) and the public key as an authorized_keys line
 * ending in `comment`.
 */
export function generateSshKeyPair(comment: string): {
	privateKey: string;
	publicKey: string;
} {
	const pair = generateKeyPairSync("ed25519");
	const raw = Buffer.from(
		pair.publicKey.export({ format: "jwk" }).x ?? "",
		"base64url",
	);
	const blob = Buffer.concat([
		lengthPrefixed(Buffer.from("ssh-ed25519")),
		lengthPrefixed(raw),
	]);
	return {
		privateKey: pair.privateKey
			.export({ format: "pem", type: "pkcs8" })
			.toString(),
		publicKey: `ssh-ed25519 ${blob.toString("base64")} ${comment}`,
	};
}
