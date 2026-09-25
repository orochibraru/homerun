import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";
import type { DnsSyncResult } from "./dns-result";
import {
	matchPangolinDomain,
	type PangolinDomain,
	type PangolinDomainMatch,
	targetScheme,
} from "./pangolin/domains";
import {
	PangolinApiError,
	type PangolinEnvelope,
	pangolinListAll,
	pangolinRequest,
} from "./pangolin/http";

const logger = new Logger("Pangolin");

// Hand-typed against the real Integration API OpenAPI document, which *is*
// fetchable after all : GET https://api.pangolin.net/v1/openapi.json (the
// Swagger UI at /v1/docs is a widget over it). This file used to carry a
// "the OAS is broken, types are guesses" note inherited from
// github.com/orochibraru/dokploy-to-pangolin ; the paths and request bodies
// below are now checked against that document. Response payloads for the
// list endpoints are typed as a bare `object` there, so those shapes are
// still hand-written, /org/{orgId}/domains being the one fully specified.
interface PangolinResource {
	enabled?: boolean;
	fullDomain: string | null;
	mode?: string | null;
	name: string;
	resourceId: number | string;
	sso?: boolean;
}

interface PangolinSite {
	name: string;
	siteId: number | string;
}

interface PangolinResourceTarget {
	targetId: number | string;
}

interface PangolinTarget extends PangolinResourceTarget {
	enabled?: boolean;
	ip: string;
	method?: string | null;
	port: number;
	siteId?: number | string;
}

export interface PangolinVerifyInput {
	baseDomain?: string | null;
	baseUrl: string;
	orgId: string;
	siteName?: string | null;
	token: string;
}

export interface PangolinVerifyResult {
	detail?: string;
	error?: string;
	success: boolean;
}

/**
 * Auto-manages routing for deployed services via a self-hosted Pangolin
 * instance's Integration API : an alternative to CloudflareService (see
 * cloudflare.service.ts) for instances that front themselves with Pangolin
 * (a tunnel/reverse-proxy manager) instead of a DNS provider Traefik can ACME
 * against directly. A service with `dnsResolvable` gets a Pangolin Resource
 * (a subdomain under one of the org's already-registered Pangolin domains)
 * created, plus a Target pointing at this Homerun host's own Traefik
 * entrypoint through the configured "site"'s tunnel, instead of the admin
 * wiring one up by hand for every service.
 *
 * Every entry point returns a `DnsSyncResult`/`PangolinVerifyResult` instead
 * of `void` : this used to swallow every failure into a `logger.warn`, so a
 * misconfigured integration looked identical to a working one (the Settings
 * page's own "Test connection" passed, since it only listed sites) and the
 * only evidence was a log line nobody was looking at. The deploy pipeline now
 * writes the outcome into the deployment log, see deploy.service.ts.
 *
 * Deliberately hand-rolled fetch calls, not an `openapi-fetch` client : that
 * would be a real dependency and a generated-types build step for one
 * caller, and plain `fetch` matches this codebase's existing
 * CloudflareService/git-provider posture.
 *
 * Deliberately re-reads instance settings itself on every call rather than
 * caching them on the instance, same reasoning as CloudflareService : the
 * token/org/site can change on /settings mid-session, and syncs are
 * infrequent (once per deploy), so there's no meaningful state worth caching
 * here.
 */
class PangolinServiceClass {
	/** Lists every domain registered to the org, following pagination. */
	private listDomains(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinDomain[]> {
		return pangolinListAll<PangolinDomain>({
			baseUrl,
			field: "domains",
			pageParam: "offset",
			path: `/org/${orgId}/domains`,
			sizeParam: "limit",
			token,
		});
	}

	/**
	 * The base domains registered to the configured org, sorted, or null when
	 * Pangolin isn't the DNS provider.
	 *
	 * @throws PangolinApiError when Pangolin refuses the call.
	 */
	async listDomainNames(): Promise<string[] | null> {
		const settings = await InstanceSettingsDTO.get();
		const token = settings.decryptPangolinApiToken();
		const baseUrl = settings.pangolinApiBaseUrl;
		const orgId = settings.pangolinOrgId;
		if (!(settings.pangolinConfigured && token && baseUrl && orgId)) {
			return null;
		}
		const domains = await this.listDomains(baseUrl, token, orgId);
		return domains.map((domain) => domain.baseDomain).sort();
	}

	/** Lists every resource in the org, following pagination. */
	private listResources(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinResource[]> {
		return pangolinListAll<PangolinResource>({
			baseUrl,
			field: "resources",
			pageParam: "page",
			path: `/org/${orgId}/resources`,
			sizeParam: "pageSize",
			token,
		});
	}

	/** Lists every site in the org, following pagination. */
	private listSites(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinSite[]> {
		return pangolinListAll<PangolinSite>({
			baseUrl,
			field: "sites",
			pageParam: "page",
			path: `/org/${orgId}/sites`,
			sizeParam: "pageSize",
			token,
		});
	}

	/**
	 * Creates a Pangolin Resource (a subdomain under `params.domainId`) for
	 * `params.name`.
	 *
	 * @throws When Pangolin's response carries no resource id.
	 */
	private async createResource(
		baseUrl: string,
		token: string,
		orgId: string,
		params: { domainId: string; name: string; subdomain: string | null },
	): Promise<PangolinResource> {
		const response = await pangolinRequest<PangolinEnvelope<PangolinResource>>(
			baseUrl,
			token,
			`/org/${orgId}/resource`,
			{
				body: JSON.stringify({
					domainId: params.domainId,
					http: true,
					name: params.name,
					postAuthPath: "/",
					protocol: "tcp",
					stickySession: true,
					subdomain: params.subdomain,
				}),
				method: "PUT",
			},
		);
		if (!response.data?.resourceId) {
			throw new Error(
				`Pangolin created no resource id for ${params.name}: ${JSON.stringify(response.data)}`,
			);
		}
		return response.data;
	}

	/** Turns Pangolin's own SSO gate on or off for a resource. */
	private setResourceSso(
		baseUrl: string,
		token: string,
		resourceId: number | string,
		sso: boolean,
	): Promise<unknown> {
		return pangolinRequest(baseUrl, token, `/resource/${resourceId}`, {
			body: JSON.stringify({ sso }),
			method: "POST",
		});
	}

	/** Adds a new Target (host:port behind a site's tunnel) to a resource. */
	private createResourceTarget(
		baseUrl: string,
		token: string,
		params: {
			host: string;
			port: number;
			resourceId: number | string;
			siteId: number | string;
		},
	): Promise<PangolinEnvelope<PangolinResourceTarget>> {
		return pangolinRequest<PangolinEnvelope<PangolinResourceTarget>>(
			baseUrl,
			token,
			`/resource/${params.resourceId}/target`,
			{
				body: JSON.stringify({
					enabled: true,
					ip: params.host,
					method: targetScheme(params.port),
					port: params.port,
					siteId: params.siteId,
				}),
				method: "PUT",
			},
		);
	}

	/**
	 * Loads instance settings and returns the resolved Pangolin call
	 * parameters, or `null` when Pangolin integration isn't fully configured.
	 * Decrypts the stored API token, and when no explicit target host is set,
	 * resolves one via `DockerService.tunnelTargetHost()`; a detected Traefik
	 * container name always pairs with Traefik's in-container port 443, since
	 * the configured port is a host port.
	 */
	private async settingsOrNull(): Promise<{
		baseUrl: string;
		mainSiteName: string;
		orgId: string;
		ownsAuth: boolean;
		port: number;
		targetHost: string;
		token: string;
	} | null> {
		const settings = await InstanceSettingsDTO.get();
		if (!settings.pangolinConfigured) {
			return null;
		}
		const token = settings.decryptPangolinApiToken();
		const baseUrl = settings.pangolinApiBaseUrl;
		const orgId = settings.pangolinOrgId;
		const mainSiteName = settings.pangolinMainSiteName;
		if (!(token && baseUrl && orgId && mainSiteName)) {
			return null;
		}
		const targetHost =
			settings.pangolinTargetHost ?? (await DockerService.tunnelTargetHost());
		const inNetwork =
			!settings.pangolinTargetHost && targetHost !== "localhost";
		return {
			baseUrl,
			mainSiteName,
			orgId,
			ownsAuth: settings.pangolinOwnsAuth,
			port: inNetwork ? 443 : settings.pangolinTargetPort,
			targetHost,
			token,
		};
	}

	/** Lists every Target currently attached to a resource, following pagination. */
	private listTargets(
		baseUrl: string,
		token: string,
		resourceId: number | string,
	): Promise<PangolinTarget[]> {
		return pangolinListAll<PangolinTarget>({
			baseUrl,
			field: "targets",
			pageParam: "offset",
			path: `/resource/${resourceId}/targets`,
			sizeParam: "limit",
			token,
		});
	}

	/**
	 * Makes the resource route to `connection.targetHost`:`connection.port` over the right
	 * scheme through `siteId`. A target that already matches on host, port,
	 * scheme, site and enabled is left alone; otherwise the one on the same
	 * host and port (or else the first one) is updated in place, and a resource
	 * with no target at all gets one created, so a redeploy never stacks a
	 * second target behind Pangolin's load balancer.
	 *
	 * @returns A human-readable summary of what changed, for the deploy log.
	 */
	private async ensureTarget(
		connection: {
			baseUrl: string;
			port: number;
			targetHost: string;
			token: string;
		},
		resourceId: number | string,
		siteId: number | string,
	): Promise<string> {
		const { baseUrl, port, targetHost, token } = connection;
		const method = targetScheme(port);
		const wanted = `${method}://${targetHost}:${port}`;
		const targets = await this.listTargets(baseUrl, token, resourceId);
		const sameAddress = (target: PangolinTarget) =>
			target.ip === targetHost && target.port === port;
		const healthy = targets.some(
			(target) =>
				sameAddress(target) &&
				(target.method ?? method) === method &&
				(target.siteId === undefined ||
					String(target.siteId) === String(siteId)) &&
				target.enabled !== false,
		);
		if (healthy) {
			return `target ${wanted}`;
		}
		const stale = targets.find(sameAddress) ?? targets[0];
		if (!stale) {
			await this.createResourceTarget(baseUrl, token, {
				host: targetHost,
				port,
				resourceId,
				siteId,
			});
			return `target ${wanted} added`;
		}
		await pangolinRequest(baseUrl, token, `/target/${stale.targetId}`, {
			body: JSON.stringify({
				enabled: true,
				ip: targetHost,
				method,
				port,
				siteId,
			}),
			method: "POST",
		});
		return sameAddress(stale)
			? `target ${wanted} repaired`
			: `target moved from ${stale.ip}:${stale.port} to ${wanted}`;
	}

	/** The HTTP resource already routing `hostname`, compared case-insensitively, ignoring inference resources that may share a domain. */
	private async findResource(
		baseUrl: string,
		token: string,
		orgId: string,
		hostname: string,
	): Promise<PangolinResource | undefined> {
		const resources = await this.listResources(baseUrl, token, orgId);
		const host = hostname.toLowerCase();
		return resources.find(
			(resource) =>
				resource.fullDomain?.toLowerCase() === host &&
				resource.mode !== "inference",
		);
	}

	/**
	 * Heals a resource that already exists: its SSO flag is written only when
	 * it differs from `sso`, and its target is repaired (see `ensureTarget`).
	 * A resource disabled in Pangolin is reported, not re-enabled.
	 */
	private async healResource(
		connection: {
			baseUrl: string;
			port: number;
			targetHost: string;
			token: string;
		},
		resource: PangolinResource,
		siteId: number | string,
		sso: boolean,
	): Promise<string> {
		if (resource.sso !== sso) {
			await this.setResourceSso(
				connection.baseUrl,
				connection.token,
				resource.resourceId,
				sso,
			);
		}
		const target = await this.ensureTarget(
			connection,
			resource.resourceId,
			siteId,
		);
		const disabled =
			resource.enabled === false ? ", but it's disabled in Pangolin" : "";
		return `Pangolin SSO ${sso ? "on" : "off"}, ${target}${disabled}`;
	}

	/**
	 * The registered, verified domain a new resource for `hostname` would be
	 * created under, or the reason there isn't one, phrased for the deploy log.
	 */
	private async routingDomain(
		baseUrl: string,
		token: string,
		orgId: string,
		hostname: string,
	): Promise<{ match: PangolinDomainMatch } | { problem: string }> {
		const domains = await this.listDomains(baseUrl, token, orgId);
		const match = matchPangolinDomain(hostname, domains);
		if (!match) {
			return {
				problem: `no registered Pangolin domain covers ${hostname} (registered: ${
					domains.map((domain) => domain.baseDomain).join(", ") || "none"
				})`,
			};
		}
		if (match.domain.verified === false) {
			return {
				problem: `Pangolin domain ${match.domain.baseDomain} isn't verified yet, so it can't hold ${hostname}`,
			};
		}
		return { match };
	}

	/**
	 * Creates the resource for `hostname`, or, when Pangolin answers 409
	 * because a concurrent sync already created it, returns that one to heal.
	 *
	 * @throws Any other create failure, or a 409 whose resource can't be found.
	 */
	private async createOrAdopt(
		connection: { baseUrl: string; orgId: string; token: string },
		hostname: string,
		match: PangolinDomainMatch,
	): Promise<{ adopted: PangolinResource } | { created: PangolinResource }> {
		const { baseUrl, orgId, token } = connection;
		try {
			return {
				created: await this.createResource(baseUrl, token, orgId, {
					domainId: match.domain.domainId,
					name: match.subdomain ?? hostname,
					subdomain: match.subdomain,
				}),
			};
		} catch (error) {
			const winner =
				error instanceof PangolinApiError && error.status === 409
					? await this.findResource(baseUrl, token, orgId, hostname)
					: undefined;
			if (!winner) {
				throw error;
			}
			return { adopted: winner };
		}
	}

	/**
	 * Creates a Pangolin Resource + Target for `hostname`, or heals the one
	 * that already exists (SSO flag and target). A create that loses a race to
	 * another sync (Pangolin's 409 "Resource with that domain already exists")
	 * falls back to healing the winner. Never throws into the deploy pipeline:
	 * a missed routing sync isn't worth failing a deploy over, but the outcome
	 * is reported back rather than swallowed.
	 */
	async syncDnsRecord(
		hostname: string,
		options: { sso?: boolean } = {},
	): Promise<DnsSyncResult | null> {
		const connection = await this.settingsOrNull();
		if (!connection) {
			return null;
		}
		const { baseUrl, mainSiteName, orgId, port, targetHost, token } =
			connection;
		const sso = options.sso ?? connection.ownsAuth;

		try {
			const sites = await this.listSites(baseUrl, token, orgId);
			const mainSite = sites.find((site) => site.name === mainSiteName);
			if (!mainSite) {
				return {
					detail: `site "${mainSiteName}" not found (available: ${
						sites.map((site) => site.name).join(", ") || "none"
					})`,
					ok: false,
					provider: "pangolin",
				};
			}

			const existing = await this.findResource(baseUrl, token, orgId, hostname);
			if (existing) {
				const healed = await this.healResource(
					connection,
					existing,
					mainSite.siteId,
					sso,
				);
				return {
					detail: `${hostname} already has a resource, ${healed}`,
					ok: true,
					provider: "pangolin",
				};
			}

			const routing = await this.routingDomain(baseUrl, token, orgId, hostname);
			if ("problem" in routing) {
				return { detail: routing.problem, ok: false, provider: "pangolin" };
			}
			const { match } = routing;

			const outcome = await this.createOrAdopt(connection, hostname, match);
			if ("adopted" in outcome) {
				const healed = await this.healResource(
					connection,
					outcome.adopted,
					mainSite.siteId,
					sso,
				);
				return {
					detail: `${hostname} was created concurrently, ${healed}`,
					ok: true,
					provider: "pangolin",
				};
			}
			const resource = outcome.created;
			await this.setResourceSso(baseUrl, token, resource.resourceId, sso);
			await this.createResourceTarget(baseUrl, token, {
				host: targetHost,
				port,
				resourceId: resource.resourceId,
				siteId: mainSite.siteId,
			});
			logger.info(`Pangolin resource created: ${hostname} -> ${mainSiteName}`);
			return {
				detail: `created ${hostname} -> ${targetScheme(port)}://${targetHost}:${port} via ${mainSiteName}`,
				ok: true,
				provider: "pangolin",
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn(`Couldn't sync Pangolin resource for ${hostname}`, {
				error: detail,
			});
			return { detail, ok: false, provider: "pangolin" };
		}
	}

	/**
	 * Removes the resource routing `hostname` when its service is deleted
	 * (Pangolin cascades its targets). A resource already gone, before the
	 * lookup or between lookup and delete (a 404), counts as success. Never
	 * throws.
	 */
	async deleteDnsRecord(hostname: string): Promise<DnsSyncResult | null> {
		const connection = await this.settingsOrNull();
		if (!connection) {
			return null;
		}
		const { baseUrl, orgId, token } = connection;

		try {
			const existing = await this.findResource(baseUrl, token, orgId, hostname);
			if (!existing) {
				return {
					detail: `no resource for ${hostname}`,
					ok: true,
					provider: "pangolin",
				};
			}
			try {
				await pangolinRequest(
					baseUrl,
					token,
					`/resource/${existing.resourceId}`,
					{
						method: "DELETE",
					},
				);
			} catch (error) {
				if (!(error instanceof PangolinApiError && error.status === 404)) {
					throw error;
				}
			}
			logger.info(`Pangolin resource removed: ${hostname}`);
			return { detail: `removed ${hostname}`, ok: true, provider: "pangolin" };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn(`Couldn't remove Pangolin resource for ${hostname}`, {
				error: detail,
			});
			return { detail, ok: false, provider: "pangolin" };
		}
	}

	/**
	 * Live end-to-end configuration check for the Settings page's "Test
	 * connection" button : confirms the token can list the org's sites *and*
	 * that the configured site exists and a verified domain can route a
	 * service hostname under this instance's base domain. The old version only
	 * listed sites, so it passed happily on a configuration that could never
	 * create a single resource.
	 */
	async verifyConnection(
		input: PangolinVerifyInput,
	): Promise<PangolinVerifyResult> {
		const { baseDomain, baseUrl, orgId, siteName, token } = input;
		try {
			const sites = await this.listSites(baseUrl, token, orgId);
			const site = siteName
				? sites.find((candidate) => candidate.name === siteName)
				: undefined;
			if (siteName && !site) {
				return {
					error: `Site "${siteName}" doesn't exist in that org. Available: ${
						sites.map((candidate) => candidate.name).join(", ") || "none"
					}.`,
					success: false,
				};
			}

			const domains = await this.listDomains(baseUrl, token, orgId);
			const match = baseDomain
				? matchPangolinDomain(`service.${baseDomain}`, domains)
				: null;
			if (baseDomain && !match) {
				return {
					error: `No registered Pangolin domain covers "${baseDomain}", so no service hostname could ever be routed. A CNAME-type domain only routes its own exact name. Registered: ${
						domains.map((domain) => domain.baseDomain).join(", ") || "none"
					}.`,
					success: false,
				};
			}
			if (match?.domain.verified === false) {
				return {
					error: `Pangolin domain ${match.domain.baseDomain} covers "${baseDomain}" but isn't verified yet, so Pangolin will refuse to create resources under it.`,
					success: false,
				};
			}

			const parts = [`${sites.length} site(s)`, `${domains.length} domain(s)`];
			if (site) {
				parts.push(`site "${site.name}" found`);
			}
			if (match) {
				parts.push(`${baseDomain} routes under ${match.domain.baseDomain}`);
			}
			return { detail: parts.join(", "), success: true };
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
				success: false,
			};
		}
	}
}

export const PangolinService = new PangolinServiceClass();
