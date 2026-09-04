import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import {
	InstanceSettingsDTO,
	type OauthProviderInput,
} from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { applyAndRebuild } from "$lib/server/validation/instance-settings-form";

const logger = new Logger("InstanceSettings");

async function validateDiscoveryUrl(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) {
			return `Returned HTTP ${res.status}.`;
		}
		const body = (await res.json().catch(() => null)) as {
			issuer?: string;
		} | null;
		if (!body?.issuer) {
			return 'Didn\'t return a valid OpenID discovery document (missing "issuer").';
		}
		return null;
	} catch (error) {
		return error instanceof Error
			? `Couldn't be reached: ${error.message}`
			: "Couldn't be reached.";
	}
}

export const actions = {
	updateOauth: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const names = formData.getAll("oauthName").map(String);
		const clientIds = formData.getAll("oauthClientId").map(String);
		const clientSecrets = formData.getAll("oauthClientSecret").map(String);
		const discoveryUrls = formData.getAll("oauthDiscoveryUrl").map(String);
		const scopesRaw = formData.getAll("oauthScopes").map(String);
		const enabledFlags = formData.getAll("oauthEnabled").map(String);
		const pkceFlags = formData.getAll("oauthPkce").map(String);

		const providers: OauthProviderInput[] = [];
		for (let i = 0; i < names.length; i += 1) {
			const name = names[i]?.trim();
			if (!name) {
				continue;
			}
			const clientId = clientIds[i]?.trim() ?? "";
			const discoveryUrl = discoveryUrls[i]?.trim() ?? "";
			if (!(clientId && discoveryUrl)) {
				return fail(400, {
					error: `Provider "${name}" needs a client id and discovery URL.`,
				});
			}
			providers.push({
				clientId,
				clientSecret: clientSecrets[i]?.trim() || undefined,
				discoveryUrl,
				enabled: enabledFlags[i] === "true",
				name,
				pkce: pkceFlags[i] === "true",
				scopes: (scopesRaw[i] ?? "")
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean),
			});
		}

		const validations = await Promise.all(
			providers.map((p) => validateDiscoveryUrl(p.discoveryUrl)),
		);
		const firstFailure = validations.findIndex((v) => v !== null);
		if (firstFailure !== -1) {
			return fail(400, {
				error: `Provider "${providers[firstFailure].name}"'s discovery URL is invalid: ${validations[firstFailure]}`,
			});
		}

		const settings = await InstanceSettingsDTO.get();
		await settings.updateOauthProviders(providers);
		applyAndRebuild(settings);
		logger.info(
			`OAuth providers updated: count=${providers.length} user=${locals.user.id}`,
		);
		return { savedSection: "oauth", success: true };
	},
};
