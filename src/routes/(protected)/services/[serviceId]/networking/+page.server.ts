import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { updatePortsSchema } from "$lib/server/validation/service";
import { DockerService } from "$lib/services/docker.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Services");

// Loose hostname check — real validation is "does DNS for this actually
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
		const authRequired = formData.get("authRequired") === "on";
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
			authRequired,
			customDomain,
			...sslUpdateFields(clearSsl, customSslCert, customSslKey),
		});

		await DockerService.syncCustomSslConfig(svc);

		logger.info(
			`Networking updated: service=${svc.id} domain=${customDomain ?? "none"} authRequired=${authRequired} user=${locals.user.id}`,
		);
		return { success: true };
	},
	// Container port, protocol, network mode, and DNS-resolvability — moved
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
			// route to — force this off regardless of what was submitted,
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
