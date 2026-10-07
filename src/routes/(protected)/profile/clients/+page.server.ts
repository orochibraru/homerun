import { fail, redirect } from "@sveltejs/kit";
import { OauthGrantDTO } from "#lib/dto/oauth-grant-dto.js";
import { Logger } from "#lib/logger.js";
import {
	API_KEY_EXPIRY_OPTIONS,
	intersectPermissions,
	type Permissions,
	parsePermissions,
	permissionsFromForm,
	toApiKeyPermissions,
} from "#lib/permissions.js";
import { auth } from "#lib/services/auth.js";
import { resolve } from "$app/paths";

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

export const load = async ({ locals, parent, request }) => {
	const { user } = await parent();
	const authorizedApps = await OauthGrantDTO.listForUser(user.id);
	// listApiKeys is user-scoped via the cookie session (sessionMiddleware),
	// same shape as listSessions : returns this user's own keys only. Wrapped
	// defensively (same posture as the Sessions tab) rather than trusted to
	// always succeed against a live session.
	try {
		const { apiKeys } = (await auth.api.listApiKeys({
			headers: request.headers,
		})) as { apiKeys: ApiKeyRow[] };

		return {
			authorizedApps,
			apiKeys: apiKeys.map((key) => ({
				createdAt: key.createdAt,
				enabled: key.enabled ?? true,
				expiresAt: key.expiresAt,
				id: key.id,
				lastRequest: key.lastRequest,
				name: key.name,
				permissions: key.permissions ? parsePermissions(key.permissions) : null,
				prefix: key.prefix,
				start: key.start,
			})),
			grantable: locals.permissions,
		};
	} catch (error) {
		logger.warn("Couldn't list API keys", {
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			authorizedApps,
			apiKeys: [] as (Omit<ApiKeyRow, "permissions"> & {
				permissions: Permissions | null;
			})[],
			grantable: locals.permissions,
		};
	}
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() || "API key";
		const expiry = API_KEY_EXPIRY_OPTIONS.find(
			(option) => option.value === formData.get("expiry"),
		);
		if (!expiry) {
			return fail(400, { error: "Pick when the key expires." });
		}
		const allPermissions = formData.get("allPermissions") === "on";
		const permissions = intersectPermissions(
			permissionsFromForm(formData),
			locals.permissions,
		);
		if (!allPermissions && Object.keys(permissions).length === 0) {
			return fail(400, {
				error: "Pick at least one permission, or allow all of them.",
			});
		}

		try {
			const created = await auth.api.createApiKey({
				body: {
					expiresIn: expiry.days ? expiry.days * 86_400 : null,
					name,
					permissions: allPermissions
						? undefined
						: toApiKeyPermissions(permissions),
					userId: locals.user.id,
				},
			});
			logger.info(
				`API key created: name=${name} expiry=${expiry.value} permissions=${allPermissions ? "all" : JSON.stringify(permissions)} user=${locals.user.id}`,
			);
			return { key: created.key, success: true };
		} catch (error) {
			logger.warn("Couldn't create API key", {
				error: error instanceof Error ? error.message : String(error),
			});
			return fail(400, { error: "Couldn't create an API key." });
		}
	},

	revokeApp: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		const clientId = (formData.get("clientId") as string | null)?.trim();
		if (!clientId) {
			return fail(400, { error: "Missing app id." });
		}
		await OauthGrantDTO.revokeForUser(locals.user.id, clientId);
		logger.info(
			`App access revoked: client=${clientId} user=${locals.user.id}`,
		);
		return { appRevoked: true };
	},

	revoke: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
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
