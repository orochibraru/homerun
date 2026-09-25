import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { publishedPortsProblem } from "$lib/published-ports";
import {
	publishedPortsSchema,
	updatePortsSchema,
} from "$lib/server/validation/service";
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

export const load = async ({ parent }) => {
	await parent();
	return { httpCacheAvailable: config.traefik.httpCache };
};

export const actions = {
	updateCache: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const raw = String(
			(await request.formData()).get("httpCacheTtl") ?? "",
		).trim();
		const ttl = raw === "" ? null : Number(raw);
		if (ttl !== null && !(Number.isInteger(ttl) && ttl >= 1 && ttl <= 86_400)) {
			return fail(400, {
				error: "Cache time must be a whole number of seconds, 1 to 86400.",
			});
		}
		await svc.update({ httpCacheTtl: ttl });
		logger.info(
			`Response cache updated: service=${svc.id} ttl=${ttl ?? "off"} user=${locals.user.id}`,
		);
		return { success: true };
	},

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
		const rawDomains = formData.getAll("domains").map(String);
		const domains = normalizeDomains(rawDomains).filter(
			(domain) => domain !== fallback,
		);
		const rawPorts = formData.getAll("domainPorts").map(String);
		const domainPorts: Record<string, number> = {};
		for (const [index, raw] of rawDomains.entries()) {
			const domain = raw.trim().toLowerCase();
			const port = (rawPorts[index] ?? "").trim();
			if (!(port && domains.includes(domain))) {
				continue;
			}
			const value = Number(port);
			if (!Number.isInteger(value) || value < 1 || value > 65_535) {
				return fail(400, {
					error: `The port for ${domain} must be a number between 1 and 65535.`,
				});
			}
			if (value !== svc.containerPort) {
				domainPorts[domain] = value;
			}
		}

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
			domainPorts,
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

	updatePublishedPorts: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		let raw: unknown;
		try {
			raw = JSON.parse(
				String((await request.formData()).get("publishedPorts") ?? "[]"),
			);
		} catch {
			return fail(400, { error: "Couldn't read the port list." });
		}
		const result = publishedPortsSchema.safeParse(raw);
		if (!result.success) {
			return fail(400, {
				error: "Every port must be a number between 1 and 65535.",
			});
		}
		const ports = result.data;
		const problem = publishedPortsProblem(ports);
		if (problem) {
			return fail(400, { error: problem });
		}
		const taken = await ServiceDTO.publishedPortTaken(ports, svc.id);
		if (taken) {
			return fail(400, {
				error: `Host port ${taken.port.hostPort}/${taken.port.protocol} is already published by ${taken.serviceName}.`,
			});
		}

		await svc.update({ publishedPorts: ports });
		logger.info(
			`Published ports updated: service=${svc.id} ports=${ports.map((p) => `${p.hostPort}:${p.containerPort}/${p.protocol}`).join(",") || "none"} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
