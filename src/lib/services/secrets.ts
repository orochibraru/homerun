import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import { config } from "$lib/config";

// Registry credentials (service.registryPasswordEnc) are encrypted at
// rest with AES-256-GCM. The key is derived from the app's own auth
// secret via scrypt : no separate secret to manage/rotate for v1.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const cachedKeys = new Map<string, Buffer>();

function getKey(secret: string): Buffer {
	let key = cachedKeys.get(secret);
	if (!key) {
		key = scryptSync(secret, "homerun-registry-secrets", 32);
		cachedKeys.set(secret, key);
	}
	return key;
}

/**
 * Encrypts a plaintext into a single storable string, keyed by the app's auth
 * secret unless `secret` overrides it. internal/secrets (Go) reads and writes
 * the same format.
 */
export function encryptSecret(
	plaintext: string,
	secret: string = config.auth.secret,
): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, getKey(secret), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return [iv, authTag, ciphertext]
		.map((buf) => buf.toString("base64"))
		.join(".");
}

/** Reverses encryptSecret(). Returns null if the value can't be decrypted. */
export function decryptSecret(
	stored: string,
	secret: string = config.auth.secret,
): string | null {
	const parts = stored.split(".");
	if (parts.length !== 3) {
		return null;
	}
	const [ivB64, authTagB64, ciphertextB64] = parts;

	try {
		const iv = Buffer.from(ivB64, "base64");
		const authTag = Buffer.from(authTagB64, "base64");
		const ciphertext = Buffer.from(ciphertextB64, "base64");

		const decipher = createDecipheriv(ALGORITHM, getKey(secret), iv);
		decipher.setAuthTag(authTag);
		const plaintext = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		return plaintext.toString("utf8");
	} catch {
		return null;
	}
}
