import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "$lib/services/docker.service";
import type { DnsSyncResult } from "./dns-result";

const logger = new Logger("Pangolin");

// Hand-typed against the real Integration API OpenAPI document, which *is*
// fetchable after all : GET https://api.pangolin.net/v1/openapi.json (the
// Swagger UI at /v1/docs is a widget over it). This file used to carry a
// "the OAS is broken, types are guesses" note inherited from
// github.com/orochibraru/dokploy-to-pangolin ; the paths and request bodies
// below are now checked against that document. Response payloads for the
// list endpoints are typed as a bare `object` there, so those shapes are
// still hand-written, /org/{orgId}/domains being the one fully specified.
interface PangolinDomain {
	baseDomain: string;
	domainId: string;
}

interface PangolinResource {
	fullDomain: string;
	name: string;
	resourceId: number | string;
}

interface PangolinSite {
	name: string;
	siteId: number | string;
}

interface PangolinResourceTarget {
	targetId: number | string;
}

interface PangolinTarget extends PangolinResourceTarget {
	ip: string;
	port: number;
}

/** Pangolin's own response envelope : `{data, success, message?, error?}`, `data` holds the endpoint-specific payload. */
interface PangolinEnvelope<T> {
	data: T;
	message?: string;
	success: boolean;
}

interface PangolinPagination {
	limit?: number;
	offset?: number;
	total?: number;
}

interface PangolinListQuery {
	baseUrl: string;
	field: string;
	pageParam: "offset" | "page";
	path: string;
	sizeParam: "limit" | "pageSize";
	token: string;
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

// The list endpoints are paginated and default to 20 items per page, which
// is *not* enough to find one site or one existing resource on a real
// instance : asking for the whole set and then following `pagination.total`
// is what makes `findMainSite` and the already-exists check actually
// correct rather than accidentally right on a small org.
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Which scheme Pangolin's tunnel speaks to this host's Traefik. `method` is
 * a free-form nullable string in the Integration API's own OpenAPI document
 * (`/resource/{id}/target`), carrying the target's scheme.
 */
export function targetScheme(port: number): "http" | "https" {
	return port === 80 ? "http" : "https";
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
	/**
	 * Issues one authenticated call against the Pangolin Integration API and
	 * parses the JSON response body.
	 *
	 * @throws When the body isn't valid JSON (including an HTML dashboard
	 *   response mistaken for the API), or when the response status isn't ok.
	 */
	private async request<T>(
		baseUrl: string,
		token: string,
		path: string,
		init?: RequestInit,
	): Promise<T> {
		const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});
		const raw = await res.text();
		let body: unknown = null;
		if (raw) {
			try {
				body = JSON.parse(raw);
			} catch {
				throw new Error(
					`Pangolin API ${res.status} returned ${raw.trimStart().startsWith("<") ? "HTML, not JSON : this looks like the dashboard, not the Integration API" : "an unreadable body"}`,
				);
			}
		}
		if (!res.ok) {
			const message = (body as PangolinEnvelope<unknown> | null)?.message;
			throw new Error(`Pangolin API ${res.status}: ${message ?? raw}`);
		}
		return body as T;
	}

	/**
	 * Collects every page of a paginated list endpoint, keyed by the array's
	 * own field name (`sites`, `resources`, `domains`). Recursive rather than
	 * a loop : this repo's `noAwaitInLoops` lint rule forbids the obvious
	 * `for` version, and the requests are inherently sequential (each page
	 * depends on the previous one's count).
	 */
	private async listAll<T>(
		query: PangolinListQuery,
		collected: T[] = [],
		page = 0,
	): Promise<T[]> {
		const params = new URLSearchParams({
			[query.pageParam]:
				query.pageParam === "offset"
					? String(collected.length)
					: String(page + 1),
			[query.sizeParam]: String(PAGE_SIZE),
		});
		const res = await this.request<
			PangolinEnvelope<
				Record<string, unknown> & { pagination?: PangolinPagination }
			>
		>(query.baseUrl, query.token, `${query.path}?${params}`);
		const batch = res.data?.[query.field];
		if (!Array.isArray(batch)) {
			throw new Error(
				`Pangolin returned no "${query.field}" list for ${query.path} : is that base URL the Integration API (it ends in /v1) rather than the dashboard?`,
			);
		}
		const items = [...collected, ...(batch as T[])];
		const total = res.data.pagination?.total;
		const done =
			batch.length === 0 ||
			total === undefined ||
			items.length >= total ||
			page + 1 >= MAX_PAGES;
		return done ? items : this.listAll<T>(query, items, page + 1);
	}

	/** Lists every domain registered to the org, following pagination. */
	private listDomains(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinDomain[]> {
		return this.listAll<PangolinDomain>({
			baseUrl,
			field: "domains",
			pageParam: "offset",
			path: `/org/${orgId}/domains`,
			sizeParam: "limit",
			token,
		});
	}

	/** Lists every resource in the org, following pagination. */
	private listResources(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinResource[]> {
		return this.listAll<PangolinResource>({
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
		return this.listAll<PangolinSite>({
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
		params: { domainId: string; name: string; subdomain: string },
	): Promise<PangolinResource> {
		const res = await this.request<PangolinEnvelope<PangolinResource>>(
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
		if (!res.data?.resourceId) {
			throw new Error(
				`Pangolin created no resource id for ${params.name}: ${JSON.stringify(res.data)}`,
			);
		}
		return res.data;
	}

	/** Turns Pangolin's own SSO gate on or off for a resource. */
	private setResourceSso(
		baseUrl: string,
		token: string,
		resourceId: number | string,
		sso: boolean,
	): Promise<unknown> {
		return this.request(baseUrl, token, `/resource/${resourceId}`, {
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
		return this.request<PangolinEnvelope<PangolinResourceTarget>>(
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

	/** Finds the Pangolin domain (and the subdomain prefix within it) that `hostname` belongs to, or null if no registered domain matches. */
	private matchDomain(
		hostname: string,
		domains: PangolinDomain[],
	): { domain: PangolinDomain; subdomain: string } | null {
		const domain = domains.find(
			(d) => hostname === d.baseDomain || hostname.endsWith(`.${d.baseDomain}`),
		);
		if (!domain) {
			return null;
		}
		const subdomain =
			hostname === domain.baseDomain
				? ""
				: hostname.slice(0, -`.${domain.baseDomain}`.length);
		return { domain, subdomain };
	}

	/**
	 * Loads instance settings and returns the resolved Pangolin call
	 * parameters, or `null` when Pangolin integration isn't fully configured.
	 * Decrypts the stored API token, and when no explicit target host is set,
	 * resolves one via `DockerService.tunnelTargetHost()`.
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
		return {
			baseUrl,
			mainSiteName,
			orgId,
			ownsAuth: settings.pangolinOwnsAuth,
			port: settings.pangolinTargetPort,
			targetHost:
				settings.pangolinTargetHost ?? (await DockerService.tunnelTargetHost()),
			token,
		};
	}

	/** Lists every Target currently attached to a resource, following pagination. */
	private listTargets(
		baseUrl: string,
		token: string,
		resourceId: number | string,
	): Promise<PangolinTarget[]> {
		return this.listAll<PangolinTarget>({
			baseUrl,
			field: "targets",
			pageParam: "offset",
			path: `/resource/${resourceId}/targets`,
			sizeParam: "limit",
			token,
		});
	}

	/**
	 * Makes the resource's target point at `cfg.targetHost`:`cfg.port`,
	 * creating one if the resource has none yet, or moving the existing
	 * (stale) target instead of creating a second one.
	 *
	 * @returns A human-readable summary of what changed, for the deploy log.
	 */
	private async ensureTarget(
		cfg: { baseUrl: string; port: number; targetHost: string; token: string },
		resourceId: number | string,
		siteId: number | string,
	): Promise<string> {
		const { baseUrl, port, targetHost, token } = cfg;
		const wanted = `${targetScheme(port)}://${targetHost}:${port}`;
		const targets = await this.listTargets(baseUrl, token, resourceId);
		if (targets.some((t) => t.ip === targetHost && t.port === port)) {
			return `target ${wanted}`;
		}
		const [stale] = targets;
		if (!stale) {
			await this.createResourceTarget(baseUrl, token, {
				host: targetHost,
				port,
				resourceId,
				siteId,
			});
			return `target ${wanted} added`;
		}
		await this.request(baseUrl, token, `/target/${stale.targetId}`, {
			body: JSON.stringify({
				enabled: true,
				ip: targetHost,
				method: targetScheme(port),
				port,
				siteId,
			}),
			method: "POST",
		});
		return `target moved from ${stale.ip}:${stale.port} to ${wanted}`;
	}

	/**
	 * Creates a Pangolin Resource + Target for `hostname` if one doesn't
	 * already exist. Never throws into the deploy pipeline : a missed routing
	 * sync isn't worth failing a deploy over, the admin can always wire it up
	 * by hand, but the outcome is reported back rather than swallowed.
	 */
	async syncDnsRecord(
		hostname: string,
		opts: { sso?: boolean } = {},
	): Promise<DnsSyncResult | null> {
		const cfg = await this.settingsOrNull();
		if (!cfg) {
			return null;
		}
		const { baseUrl, mainSiteName, orgId, port, targetHost, token } = cfg;
		const sso = opts.sso ?? cfg.ownsAuth;

		try {
			const sites = await this.listSites(baseUrl, token, orgId);
			const mainSite = sites.find((s) => s.name === mainSiteName);
			if (!mainSite) {
				return {
					detail: `site "${mainSiteName}" not found (available: ${
						sites.map((s) => s.name).join(", ") || "none"
					})`,
					ok: false,
					provider: "pangolin",
				};
			}

			const resources = await this.listResources(baseUrl, token, orgId);
			const existing = resources.find((r) => r.fullDomain === hostname);
			if (existing) {
				await this.setResourceSso(baseUrl, token, existing.resourceId, sso);
				const target = await this.ensureTarget(
					cfg,
					existing.resourceId,
					mainSite.siteId,
				);
				return {
					detail: `${hostname} already has a resource, Pangolin SSO ${sso ? "on" : "off"}, ${target}`,
					ok: true,
					provider: "pangolin",
				};
			}

			const domains = await this.listDomains(baseUrl, token, orgId);
			const match = this.matchDomain(hostname, domains);
			if (!match) {
				return {
					detail: `no registered Pangolin domain covers ${hostname} (registered: ${
						domains.map((d) => d.baseDomain).join(", ") || "none"
					})`,
					ok: false,
					provider: "pangolin",
				};
			}

			const resource = await this.createResource(baseUrl, token, orgId, {
				domainId: match.domain.domainId,
				name: match.subdomain || hostname,
				subdomain: match.subdomain,
			});
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
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			logger.warn(`Couldn't sync Pangolin resource for ${hostname}`, {
				error: detail,
			});
			return { detail, ok: false, provider: "pangolin" };
		}
	}

	/** Best-effort removal, same non-throwing posture as syncDnsRecord : called when a service with a Pangolin-managed hostname is deleted. */
	async deleteDnsRecord(hostname: string): Promise<DnsSyncResult | null> {
		const cfg = await this.settingsOrNull();
		if (!cfg) {
			return null;
		}
		const { baseUrl, orgId, token } = cfg;

		try {
			const resources = await this.listResources(baseUrl, token, orgId);
			const existing = resources.find((r) => r.fullDomain === hostname);
			if (!existing) {
				return {
					detail: `no resource for ${hostname}`,
					ok: true,
					provider: "pangolin",
				};
			}
			await this.request(baseUrl, token, `/resource/${existing.resourceId}`, {
				method: "DELETE",
			});
			logger.info(`Pangolin resource removed: ${hostname}`);
			return { detail: `removed ${hostname}`, ok: true, provider: "pangolin" };
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			logger.warn(`Couldn't remove Pangolin resource for ${hostname}`, {
				error: detail,
			});
			return { detail, ok: false, provider: "pangolin" };
		}
	}

	/**
	 * Live end-to-end configuration check for the Settings page's "Test
	 * connection" button : confirms the token can list the org's sites *and*
	 * that the configured site and a domain covering this instance's base
	 * domain both actually exist. The old version only listed sites, so it
	 * passed happily on a configuration that could never create a single
	 * resource, which is exactly how "test passes, nothing gets created"
	 * happened.
	 */
	async verifyConnection(
		input: PangolinVerifyInput,
	): Promise<PangolinVerifyResult> {
		const { baseDomain, baseUrl, orgId, siteName, token } = input;
		try {
			const sites = await this.listSites(baseUrl, token, orgId);
			const site = siteName
				? sites.find((s) => s.name === siteName)
				: undefined;
			if (siteName && !site) {
				return {
					error: `Site "${siteName}" doesn't exist in that org. Available: ${
						sites.map((s) => s.name).join(", ") || "none"
					}.`,
					success: false,
				};
			}

			const domains = await this.listDomains(baseUrl, token, orgId);
			const match = baseDomain ? this.matchDomain(baseDomain, domains) : null;
			if (baseDomain && !match) {
				return {
					error: `No registered Pangolin domain covers "${baseDomain}", so no service hostname could ever be routed. Registered: ${
						domains.map((d) => d.baseDomain).join(", ") || "none"
					}.`,
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
		} catch (err) {
			return {
				error: err instanceof Error ? err.message : String(err),
				success: false,
			};
		}
	}
}

export const PangolinService = new PangolinServiceClass();
