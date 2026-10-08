import { fail } from "@sveltejs/kit";
import { Logger } from "#lib/logger.js";
import { type Permissions, parsePermissions } from "#lib/permissions.js";
import { auth } from "#lib/services/auth.js";

const logger = new Logger("ApiKeys");

interface ApiKeyRow {
	createdAt: Date;
	enabled: boolean | null;
	expiresAt: Date | null;
	id: string;
	lastRequest: Date | null;
	name: string | null;
	permissions: unknown;
	prefix: string | null;
	start: string | null;
}

export interface ApiKeyView {
	createdAt: Date;
	enabled: boolean;
	expiresAt: Date | null;
	id: string;
	lastRequest: Date | null;
	name: string | null;
	permissions: Permissions | null;
	prefix: string | null;
	start: string | null;
}

/**
 * The signed-in user's own API keys, read through better-auth with the
 * request's session cookie. Logs and returns an empty list when the listing
 * fails rather than failing the page.
 */
export async function listOwnApiKeys(headers: Headers): Promise<ApiKeyView[]> {
	try {
		const { apiKeys } = (await auth.api.listApiKeys({ headers })) as {
			apiKeys: ApiKeyRow[];
		};
		return apiKeys.map((key) => ({
			createdAt: key.createdAt,
			enabled: key.enabled ?? true,
			expiresAt: key.expiresAt,
			id: key.id,
			lastRequest: key.lastRequest,
			name: key.name,
			permissions: key.permissions ? parsePermissions(key.permissions) : null,
			prefix: key.prefix,
			start: key.start,
		}));
	} catch (error) {
		logger.warn("Couldn't list API keys", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

/**
 * The `revoke` form action shared by every page that lists the user's API
 * keys: deletes the key named by the form's `keyId`, as the signed-in user.
 *
 * @returns `{ revoked: true }`, or a 400 failure.
 */
export async function revokeApiKeyAction(request: Request, userId: string) {
	const keyId = String((await request.formData()).get("keyId") ?? "").trim();
	if (!keyId) {
		return fail(400, { error: "Missing key id." });
	}
	try {
		await auth.api.deleteApiKey({
			body: { keyId },
			headers: request.headers,
		});
	} catch (error) {
		logger.warn("Couldn't delete API key", {
			error: error instanceof Error ? error.message : String(error),
			keyId,
		});
		return fail(400, { error: "Couldn't revoke that key." });
	}
	logger.info(`API key revoked: key=${keyId} user=${userId}`);
	return { revoked: true };
}
