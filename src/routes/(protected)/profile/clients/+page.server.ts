import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { auth } from "$lib/services/auth";

const logger = new Logger("ApiKeys");

interface ApiKeyRow {
	createdAt: Date;
	enabled: boolean | null;
	expiresAt: Date | null;
	id: string;
	lastRequest: Date | null;
	name: string | null;
	prefix: string | null;
	start: string | null;
}

export const load = async ({ request }) => {
	// listApiKeys is user-scoped via the cookie session (sessionMiddleware),
	// same shape as listSessions : returns this user's own keys only. Wrapped
	// defensively (same posture as the Sessions tab) rather than trusted to
	// always succeed against a live session.
	try {
		const { apiKeys } = (await auth.api.listApiKeys({
			headers: request.headers,
		})) as { apiKeys: ApiKeyRow[] };

		return {
			apiKeys: apiKeys.map((k) => ({
				createdAt: k.createdAt,
				enabled: k.enabled ?? true,
				expiresAt: k.expiresAt,
				id: k.id,
				lastRequest: k.lastRequest,
				name: k.name,
				prefix: k.prefix,
				start: k.start,
			})),
		};
	} catch (error) {
		logger.warn("Couldn't list API keys", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { apiKeys: [] as ApiKeyRow[] };
	}
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() || "API key";

		try {
			// Server-only userId field, same pattern cli-auth.service.ts's
			// device-code approval already uses : bypasses the endpoint's
			// normal session requirement since we already know who's asking
			// (locals.user, not a client-supplied id).
			const created = await auth.api.createApiKey({
				body: { name, userId: locals.user.id },
			});
			logger.info(`API key created: name=${name} user=${locals.user.id}`);
			return { key: created.key, success: true };
		} catch (error) {
			logger.warn("Couldn't create API key", {
				error: error instanceof Error ? error.message : String(error),
			});
			return fail(400, { error: "Couldn't create an API key." });
		}
	},

	revoke: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const keyId = (formData.get("keyId") as string | null)?.trim();
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

		logger.info(`API key revoked: key=${keyId} user=${locals.user.id}`);
		return { revoked: true };
	},
};
