/**
 * A UUIDv4-shaped id that also works outside a secure context.
 *
 * `crypto.randomUUID()` is secure-context-gated in browsers, so on a
 * plain-HTTP instance reached at a bare IP (exactly what the installer's
 * `--mode=full` produces) it's `undefined` and calling it throws. The deploy
 * form's pre-submit callback did, which killed the submission before it ever
 * reached the server and left the button spinning forever with nothing
 * queued. `crypto.getRandomValues()` carries no such restriction.
 */
export function randomId(): string {
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join("-");
}
