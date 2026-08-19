import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { config } from "$lib/config";

// Registry credentials (service.registryPasswordEnc) are encrypted at
// rest with AES-256-GCM. The key is derived from the app's own auth
// secret via scrypt — no separate secret to manage/rotate for v1.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(config.auth.secret, "localrun-registry-secrets", 32);
  }
  return cachedKey;
}

/** Encrypts a plaintext registry password into a single storable string. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
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
export function decryptSecret(stored: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
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
