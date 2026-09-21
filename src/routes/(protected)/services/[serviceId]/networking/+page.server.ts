import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { updatePortsSchema } from "$lib/server/validation/service";
import {
	DOMAIN_RE,
	defaultHostname,
	normalizeDomains,
	serviceHostnames,
} from "$lib/service-domains";
import { syncServiceDomainsDns } from "$lib/services/dns.service";
import { DockerService } from "$lib/services/docker.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Services");

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
	updateDomains: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const stack = svc.stackId ? await StackDTO.get(svc.stackId) : null;

		const formData = await request.formData();
		const defaultDomainEnabled = formData.get("defaultDomainEnabled") === "on";
		const fallback = defaultHostname(svc.slug, stack?.slug, config.baseDomain);
		const domains = normalizeDomains(
			formData.getAll("domains").map(String),
		).filter((domain) => domain !== fallback);

		const invalid = domains.find((domain) => !DOMAIN_RE.test(domain));
		if (invalid) {
			return fail(400, { error: `"${invalid}" isn't a valid domain.` });
		}
		const taken = await ServiceDTO.domainTaken(domains, svc.id);
		if (taken) {
			return fail(400, {
				error: `${taken} is already routed to another service.`,
			});
		}
		const hostnames = serviceHostnames(
			{ defaultDomainEnabled, domains, primaryDomain: null, slug: svc.slug },
			stack?.slug,
			config.baseDomain,
		);
		if (hostnames.length === 0) {
			return fail(400, {
				error:
					"Keep at least one domain, or turn public routing off in the Network section.",
			});
		}
		const previous = serviceHostnames(
			svc.toJSON(),
			stack?.slug,
			config.baseDomain,
		);
		const chosen = String(formData.get("primaryDomain") ?? "")
			.trim()
			.toLowerCase();

		await svc.update({
			defaultDomainEnabled,
			domains,
			primaryDomain: hostnames.includes(chosen) ? chosen : hostnames[0],
		});
		if (svc.dnsResolvable) {
			void syncServiceDomainsDns(previous, hostnames);
		}

		logger.info(
			`Domains updated: service=${svc.id} domains=${hostnames.join(",")} user=${locals.user.id}`,
		);
		return { success: true };
	},

	updateSsl: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const cert = (formData.get("customSslCert") as string | null)?.trim();
		const key = (formData.get("customSslKey") as string | null)?.trim();
		const clearSsl = formData.get("clearSsl") === "on";
		if (!clearSsl && Boolean(cert) !== Boolean(key)) {
			return fail(400, {
				error: "Paste both the certificate and its private key.",
			});
		}

		await svc.update(sslUpdateFields(clearSsl, cert, key));
		await DockerService.syncCustomSslConfig(svc);

		logger.info(
			`Custom certificate ${clearSsl ? "removed" : "updated"}: service=${svc.id} user=${locals.user.id}`,
		);
		return { success: true };
	},

	// Container port, protocol, network mode, and DNS-resolvability : moved
	// here from the old Settings tab (see validation/service.ts's
	// updatePortsSchema docstring).
	updatePorts: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
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
