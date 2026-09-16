import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import {
	isOauthMethod,
	oauthMethod,
	oauthProviderName,
	PASSWORD_METHOD,
} from "$lib/auth-providers";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { invalidateGatedService } from "$lib/server/gated-service-cache";
import { updatePortsSchema } from "$lib/server/validation/service";
import { DockerService } from "$lib/services/docker.service";
import { encryptSecret } from "$lib/services/secrets";
import { UserService } from "$lib/services/user.service";

const logger = new Logger("Services");

// Loose hostname check : real validation is "does DNS for this actually
// point here", which the app has no way to verify; this just rejects
// obviously-malformed input.
const DOMAIN_RE =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Blank fields mean "leave unchanged" (same convention as registryPassword elsewhere); the explicit clearSsl checkbox is the only way to actually remove a stored cert/key. */
function sslUpdateFields(
	clearSsl: boolean,
	cert: string | undefined,
	key: string | undefined,
): { customSslCertEnc?: string | null; customSslKeyEnc?: string | null } {
	if (clearSsl) {
		return { customSslCertEnc: null, customSslKeyEnc: null };
	}
	if (cert && key) {
		return {
			customSslCertEnc: encryptSecret(cert),
			customSslKeyEnc: encryptSecret(key),
		};
	}
	return {};
}

const EMAIL_PATTERN_RE = /^(\*|[^\s@]+)@[^\s@]+\.[^\s@]+$/;

function splitList(raw: string | null): string[] {
	return [
		...new Set(
			(raw ?? "")
				.split(/[\n,]/)
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
}

export const load = async () => {
	const users = await UserService.listUsers();
	return {
		dashboardOrigin: config.auth.origin ?? null,
		oauthProviders: config.auth.oauthProviders
			.filter((p) => p.enabled)
			.map((p) => ({
				label: p.label || p.name,
				method: oauthMethod(p.name),
				name: p.name,
			})),
		users: users.map((u) => ({ email: u.email, id: u.id, name: u.name })),
	};
};

export const actions = {
	updateNetworking: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const raw = (formData.get("customDomain") as string | null)?.trim() ?? "";
		const customDomain = raw.toLowerCase() || null;
		const customSslCert = (
			formData.get("customSslCert") as string | null
		)?.trim();
		const customSslKey = (
			formData.get("customSslKey") as string | null
		)?.trim();
		const clearSsl = formData.get("clearSsl") === "on";

		if (customDomain && !DOMAIN_RE.test(customDomain)) {
			return fail(400, { error: "That doesn't look like a valid domain." });
		}
		if (
			customDomain &&
			(await ServiceDTO.customDomainTaken(customDomain, svc.id))
		) {
			return fail(400, {
				error: "That domain is already mapped to another service.",
			});
		}
		if (customSslCert && customSslKey && !customDomain) {
			return fail(400, {
				error: "A custom domain is required to attach a custom certificate.",
			});
		}

		await svc.update({
			customDomain,
			...sslUpdateFields(clearSsl, customSslCert, customSslKey),
		});

		await DockerService.syncCustomSslConfig(svc);

		logger.info(
			`Networking updated: service=${svc.id} domain=${
				customDomain ?? "none"
			} user=${locals.user.id}`,
		);
		return { success: true };
	},
	updateAppAuth: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const authRequired = formData.get("authRequired") === "on";
		const methods = [...new Set(formData.getAll("authProvider").map(String))];
		const allowedUserIds = [
			...new Set(formData.getAll("authAllowedUserId").map(String)),
		];
		const allowedEmails = splitList(
			formData.get("authAllowedEmails") as string | null,
		);
		const allowedGroups = splitList(
			formData.get("authAllowedGroups") as string | null,
		);

		const enabledOauth = new Set(
			config.auth.oauthProviders.filter((p) => p.enabled).map((p) => p.name),
		);
		for (const method of methods) {
			const providerName = oauthProviderName(method);
			const known =
				method === PASSWORD_METHOD ||
				(isOauthMethod(method) &&
					!!providerName &&
					enabledOauth.has(providerName));
			if (!known) {
				return fail(400, {
					authError: `"${method}" isn't an enabled sign-in method on this instance.`,
				});
			}
		}
		if (authRequired && methods.length === 0) {
			return fail(400, {
				authError:
					"Pick at least one sign-in method, otherwise nobody (including you) can get into this app.",
			});
		}
		if (authRequired && !config.auth.origin) {
			return fail(400, {
				authError:
					"Set Origin under Settings → General first : the login wall redirects visitors to this instance's own sign-in page, so Homerun has to know its own public URL.",
			});
		}
		const badEmail = allowedEmails.find(
			(entry) => !EMAIL_PATTERN_RE.test(entry),
		);
		if (badEmail) {
			return fail(400, {
				authError: `"${badEmail}" isn't an email address or a *@domain pattern.`,
			});
		}

		await svc.update({
			authAllowedEmails: allowedEmails,
			authAllowedGroups: allowedGroups,
			authAllowedUserIds: allowedUserIds,
			authProviders: methods,
			authRequired,
		});
		invalidateGatedService(svc.id);

		logger.info(
			`App access updated: service=${svc.id} authRequired=${authRequired} methods=${
				methods.join("|") || "none"
			} user=${locals.user.id}`,
		);
		return { authSuccess: true };
	},
	// Container port, protocol, network mode, and DNS-resolvability : moved
	// here from the old Settings tab (see validation/service.ts's
	// updatePortsSchema docstring).
	updatePorts: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updatePortsSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				portsValues: Object.fromEntries(formData),
			});
		}
		const input = result.data;
		const isHostNetwork = input.networkMode === "host";

		await svc.update({
			containerPort: input.containerPort,
			// Host mode has no container-specific network for Traefik to
			// route to : force this off regardless of what was submitted,
			// same enforcement docker/containers.ts does at deploy time (this
			// just keeps the stored value honest ahead of the next deploy).
			dnsResolvable: isHostNetwork ? false : input.dnsResolvable,
			networkMode: input.networkMode,
			portProtocol: input.portProtocol,
		});

		logger.info(
			`Ports updated: service=${svc.id} port=${input.containerPort}/${input.portProtocol} networkMode=${input.networkMode} user=${locals.user.id}`,
		);
		return { portsSuccess: true };
	},
};
