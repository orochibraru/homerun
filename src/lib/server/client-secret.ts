import { createHash, randomBytes } from "node:crypto";

/** A client secret's stored form: SHA-256, base64url without padding, the same hash better-auth's provider uses, so secrets it issued keep verifying. */
export function hashClientSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("base64url");
}

/** A fresh random client secret, 43 URL-safe characters. */
export function generateClientSecret(): string {
	return randomBytes(32).toString("base64url");
}
