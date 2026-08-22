import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { applyInstanceSettings, envDefaultsForDisplay } from "$lib/config";
import {
	InstanceSettingsDTO,
	type OauthProviderInput,
} from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { rebuildAuth } from "$lib/services/auth";
import { CloudflareService } from "$lib/services/cloudflare.service";

const logger = new Logger("InstanceSettings");

/**
 * A bad discoveryUrl doesn't just break sign-in with that one provider :
 * better-auth's genericOAuth plugin validates every configured provider's
 * discovery document while building its auth *context*, which every
 * request touching auth (including plain email/password sign-in, and
 * getSession() on every page load) goes through. An unreachable/invalid
 * discovery URL saved here would otherwise lock the admin out of the whole
 * app, /settings included : verified live while building this. So, unlike
 * the image-existence checker's "warn, don't block" precedent, this one
 * hard-blocks the save.
 */
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

/** Blank text field means "no override : fall back to the env default". */
function nullableText(formData: FormData, key: string): string | null {
	const value = (formData.get(key) as string | null)?.trim();
	return value ? value : null;
}

function checkbox(formData: FormData, key: string): boolean {
	return formData.get(key) === "on";
}

export const load = async ({ locals }) => {
	// Instance-wide config : admin only. Developers get the rest of the
	// dashboard (their own services/projects, already isolated per-user).
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const [settings, remoteHosts] = await Promise.all([
		InstanceSettingsDTO.get(),
		RemoteHostDTO.list(locals.user.id),
	]);
	return {
		envDefaults: envDefaultsForDisplay(),
		remoteHosts: remoteHosts.map((h) => h.toJSON()),
		settings: settings.toJSON(),
	};
};

/** Re-merges config from the DB after any settings save, and rebuilds auth so OAuth changes apply without a restart. */
function applyAndRebuild(settings: InstanceSettingsDTO) {
	applyInstanceSettings(settings.toConfigOverride());
	rebuildAuth();
}

export const actions = {
	testCloudflare: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const zoneId = (formData.get("cloudflareZoneId") as string | null)?.trim();
		const tokenInput = (
			formData.get("cloudflareApiToken") as string | null
		)?.trim();
		if (!zoneId) {
			return fail(400, { error: "Enter a zone id first." });
		}
		// Blank token field with an already-stored one : test against the
		// stored token, same "blank means unchanged" convention the save
		// action uses, so re-testing doesn't require retyping the secret.
		const settings = await InstanceSettingsDTO.get();
		const token = tokenInput || settings.decryptCloudflareApiToken();
		if (!token) {
			return fail(400, { error: "Enter an API token first." });
		}
		const result = await CloudflareService.verifyZoneAccess(token, zoneId);
		if (!result.success) {
			return fail(400, {
				error: `Couldn't verify zone access: ${result.error}`,
			});
		}
		return { cloudflareTestOk: true, success: true };
	},
	updateAutoscale: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const overflowRemoteHostId =
			(formData.get("autoscaleOverflowRemoteHostId") as string | null) || null;
		const cpuThreshold = Number.parseInt(
			(formData.get("autoscaleCpuThresholdPercent") as string | null) ?? "80",
			10,
		);
		const memThreshold = Number.parseInt(
			(formData.get("autoscaleMemoryThresholdPercent") as string | null) ??
				"80",
			10,
		);

		if (overflowRemoteHostId) {
			const host = await RemoteHostDTO.get(
				overflowRemoteHostId,
				locals.user.id,
			);
			if (!host) {
				return fail(400, { error: "That remote host wasn't found." });
			}
		}

		const settings = await InstanceSettingsDTO.get();
		await settings.updateAutoscale({
			autoscaleCpuThresholdPercent: Number.isFinite(cpuThreshold)
				? Math.min(99, Math.max(1, cpuThreshold))
				: 80,
			autoscaleEnabled: checkbox(formData, "autoscaleEnabled"),
			autoscaleMemoryThresholdPercent: Number.isFinite(memThreshold)
				? Math.min(99, Math.max(1, memThreshold))
				: 80,
			autoscaleOverflowRemoteHostId: overflowRemoteHostId,
		});
		logger.info(`Autoscale settings updated: user=${locals.user.id}`);
		return { savedSection: "autoscale", success: true };
	},

	updateCloudflare: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateCloudflare({
			cloudflareApiToken:
				(formData.get("cloudflareApiToken") as string | null)?.trim() ||
				undefined,
			cloudflareZoneId: nullableText(formData, "cloudflareZoneId"),
		});
		logger.info(`Cloudflare instance settings updated: user=${locals.user.id}`);
		return { savedSection: "cloudflare", success: true };
	},
	updateCore: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateCore({
			authCheckUrl: nullableText(formData, "authCheckUrl"),
			authCrossSubdomainCookies: checkbox(
				formData,
				"authCrossSubdomainCookies",
			),
			authOrigin: nullableText(formData, "authOrigin"),
			baseDomain: nullableText(formData, "baseDomain"),
		});
		applyAndRebuild(settings);
		logger.info(`Core instance settings updated: user=${locals.user.id}`);
		return { savedSection: "core", success: true };
	},

	updateDocker: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateDocker({
			dockerNetworkName: nullableText(formData, "dockerNetworkName"),
			dockerSocketPath: nullableText(formData, "dockerSocketPath"),
		});
		applyAndRebuild(settings);
		logger.info(`Docker instance settings updated: user=${locals.user.id}`);
		return { savedSection: "docker", success: true };
	},

	updateOauth: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
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
			// Blank rows are dropped, not an error : same "dropping blank keys"
			// convention as the envKey[]/envValue[] zip in validation/service.ts.
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

		// Validate every provider's discovery doc before persisting anything :
		// see validateDiscoveryUrl()'s docstring for why this can't be a
		// "warn, don't block" check like the image-existence checker.
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

	updateSmtp: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const portRaw = (formData.get("smtpPort") as string | null)?.trim();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateSmtp({
			smtpEnabled: checkbox(formData, "smtpEnabled"),
			smtpFrom: nullableText(formData, "smtpFrom"),
			smtpHost: nullableText(formData, "smtpHost"),
			smtpPassword:
				(formData.get("smtpPassword") as string | null)?.trim() || undefined,
			smtpPort: portRaw ? Number.parseInt(portRaw, 10) : null,
			smtpSecure: checkbox(formData, "smtpSecure"),
			smtpUser: nullableText(formData, "smtpUser"),
		});
		applyAndRebuild(settings);
		logger.info(`SMTP instance settings updated: user=${locals.user.id}`);
		return { savedSection: "smtp", success: true };
	},

	updateTraefik: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const traefikAcmeEmail = nullableText(formData, "traefikAcmeEmail");
		if (
			traefikAcmeEmail &&
			!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(traefikAcmeEmail)
		) {
			return fail(400, {
				error: "ACME account email isn't a valid email address.",
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateTraefik({
			traefikAcmeEmail,
			traefikCertResolver: nullableText(formData, "traefikCertResolver"),
			traefikDynamicConfigDir: nullableText(
				formData,
				"traefikDynamicConfigDir",
			),
			traefikEntrypoint: nullableText(formData, "traefikEntrypoint"),
		});
		applyAndRebuild(settings);
		logger.info(`Traefik instance settings updated: user=${locals.user.id}`);
		return { savedSection: "traefik", success: true };
	},
};
