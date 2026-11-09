import type { MailboxInput } from "#lib/services/mail.service.js";

/**
 * Reads a mailbox form's display name, owner, quota and enabled fields.
 *
 * @returns The fields, or an error message for a quota that isn't a positive whole number.
 */
export function parseMailboxFields(
	form: FormData,
): { error: string } | { fields: MailboxInput } {
	const displayName = String(form.get("displayName") ?? "").trim();
	const ownerId = String(form.get("ownerId") ?? "").trim();
	const quotaRaw = String(form.get("quotaMb") ?? "").trim();
	const quotaMb = quotaRaw ? Number(quotaRaw) : null;
	if (quotaMb !== null && !(Number.isInteger(quotaMb) && quotaMb > 0)) {
		return { error: "The quota is a whole number of MB, or empty for none." };
	}
	return {
		fields: {
			displayName: displayName || null,
			enabled: form.get("enabled") === "on",
			ownerId: ownerId || null,
			quotaMb,
		},
	};
}
