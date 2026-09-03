import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Pangolin");

// Hand-typed against api.pangolin.net/v1/docs/'s Swagger UI (a rendered
// widget, not a fetchable static doc) cross-checked with
// github.com/orochibraru/dokploy-to-pangolin, a sibling Dokploy-to-Pangolin
// bridge doing the same job for a different source platform : that project's
// own src/lib/types.ts carries the same "Custom types for Pangolin API -
// defined manually since the OAS is broken" note, same posture taken here.
interface PangolinDomain {
	baseDomain: string;
	domainId: string;
}

interface PangolinResource {
	fullDomain: string;
	name: string;
	resourceId: string;
}

interface PangolinSite {
	name: string;
	siteId: string;
}

interface PangolinResourceTarget {
	targetId: string;
}

/** Pangolin's own response envelope : `{data, success, message?, error?}`, `data` holds the endpoint-specific payload. */
interface PangolinEnvelope<T> {
	data: T;
	success: boolean;
}

/**
 * Auto-manages routing for deployed services via a self-hosted Pangolin
 * instance's REST API : an alternative to CloudflareService (see
 * cloudflare.service.ts) for instances that front themselves with Pangolin
 * (a tunnel/reverse-proxy manager) instead of a DNS provider Traefik can ACME
 * against directly. A service with `dnsResolvable` gets a Pangolin Resource
 * (a subdomain under one of the org's already-registered Pangolin domains)
 * created, plus a Target pointing at this Homerun host's own Traefik
 * entrypoint through the configured "site"'s tunnel, instead of the admin
 * wiring one up by hand for every service. Same "not live-tested against a
 * real registered account" posture as CloudflareService/git-provider OAuth :
 * verify the first real sync by hand once an org/site/API key are
 * configured.
 *
 * Deliberately hand-rolled fetch calls, not the reference project's
 * `openapi-fetch` client : that's a real dependency for a spec that project
 * itself gave up generating types from (see the type note above), plain
 * `fetch` matches this codebase's existing CloudflareService/git-provider
 * posture and avoids adding it for one caller.
 *
 * Deliberately a plain class with static methods reading instance settings
 * itself on every call, same reasoning as CloudflareService : the token/org/
 * site can change on /settings mid-session, and syncs are infrequent (once
 * per deploy), so there's no meaningful state worth caching here.
 */
export class PangolinService {
	private static async request<T>(
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
		const body = (await res.json()) as T;
		if (!res.ok) {
			throw new Error(`Pangolin API ${res.status}: ${JSON.stringify(body)}`);
		}
		return body;
	}

	private static async listDomains(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinDomain[]> {
		const res = await PangolinService.request<
			PangolinEnvelope<{ domains: PangolinDomain[] }>
		>(baseUrl, token, `/org/${orgId}/domains`);
		return res.data.domains;
	}

	private static async listResources(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<PangolinResource[]> {
		const res = await PangolinService.request<
			PangolinEnvelope<{ resources: PangolinResource[] }>
		>(baseUrl, token, `/org/${orgId}/resources`);
		return res.data.resources;
	}

	private static async findMainSite(
		baseUrl: string,
		token: string,
		orgId: string,
		mainSiteName: string,
	): Promise<PangolinSite | null> {
		const res = await PangolinService.request<
			PangolinEnvelope<{ sites: PangolinSite[] }>
		>(baseUrl, token, `/org/${orgId}/sites`);
		return res.data.sites.find((s) => s.name === mainSiteName) ?? null;
	}

	private static async createResource(
		baseUrl: string,
		token: string,
		orgId: string,
		params: { domainId: string; name: string; subdomain: string },
	): Promise<PangolinResource> {
		const res = await PangolinService.request<
			PangolinEnvelope<PangolinResource>
		>(baseUrl, token, `/org/${orgId}/resource`, {
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
		});
		return res.data;
	}

	private static async createResourceTarget(
		baseUrl: string,
		token: string,
		params: { port: number; resourceId: string; siteId: string },
	): Promise<PangolinResourceTarget> {
		const res = await PangolinService.request<
			PangolinEnvelope<PangolinResourceTarget>
		>(baseUrl, token, `/resource/${params.resourceId}/target`, {
			body: JSON.stringify({
				enabled: true,
				ip: "localhost",
				method: "http",
				port: params.port,
				siteId: params.siteId,
			}),
			method: "PUT",
		});
		return res.data;
	}

	/** Finds the Pangolin domain (and the subdomain prefix within it) that `hostname` belongs to, or null if no registered domain matches. */
	private static matchDomain(
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
	 * Creates a Pangolin Resource + Target for `hostname` if one doesn't
	 * already exist. Best-effort : never throws into the deploy pipeline,
	 * logs and returns on any failure, a missed routing sync isn't worth
	 * failing a deploy over, the admin can always wire it up by hand.
	 */
	static async syncDnsRecord(hostname: string): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		if (!settings.pangolinConfigured) {
			return;
		}
		const token = settings.decryptPangolinApiToken();
		const baseUrl = settings.pangolinApiBaseUrl;
		const orgId = settings.pangolinOrgId;
		const mainSiteName = settings.pangolinMainSiteName;
		if (!(token && baseUrl && orgId && mainSiteName)) {
			return;
		}

		try {
			const resources = await PangolinService.listResources(
				baseUrl,
				token,
				orgId,
			);
			if (resources.some((r) => r.fullDomain === hostname)) {
				return;
			}

			const domains = await PangolinService.listDomains(baseUrl, token, orgId);
			const match = PangolinService.matchDomain(hostname, domains);
			if (!match) {
				logger.warn(
					`No registered Pangolin domain matches ${hostname}, skipping`,
				);
				return;
			}

			const mainSite = await PangolinService.findMainSite(
				baseUrl,
				token,
				orgId,
				mainSiteName,
			);
			if (!mainSite) {
				logger.warn(`Pangolin site "${mainSiteName}" not found, skipping`);
				return;
			}

			const resource = await PangolinService.createResource(
				baseUrl,
				token,
				orgId,
				{
					domainId: match.domain.domainId,
					name: match.subdomain || hostname,
					subdomain: match.subdomain,
				},
			);
			await PangolinService.createResourceTarget(baseUrl, token, {
				port: settings.pangolinTargetPort,
				resourceId: resource.resourceId,
				siteId: mainSite.siteId,
			});
			logger.info(`Pangolin resource created: ${hostname} -> ${mainSiteName}`);
		} catch (err) {
			logger.warn(`Couldn't sync Pangolin resource for ${hostname}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/** Best-effort removal, same non-throwing posture as syncDnsRecord : called when a service with a Pangolin-managed hostname is deleted. */
	static async deleteDnsRecord(hostname: string): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		if (!settings.pangolinConfigured) {
			return;
		}
		const token = settings.decryptPangolinApiToken();
		const baseUrl = settings.pangolinApiBaseUrl;
		const orgId = settings.pangolinOrgId;
		if (!(token && baseUrl && orgId)) {
			return;
		}

		try {
			const resources = await PangolinService.listResources(
				baseUrl,
				token,
				orgId,
			);
			const existing = resources.find((r) => r.fullDomain === hostname);
			if (!existing) {
				return;
			}
			// DELETE /resource/{resourceId} : inferred from REST convention (the
			// reference project is create-only, it never deletes a resource),
			// not confirmed against a real instance, same caveat as the rest of
			// this file.
			await PangolinService.request(
				baseUrl,
				token,
				`/resource/${existing.resourceId}`,
				{ method: "DELETE" },
			);
			logger.info(`Pangolin resource removed: ${hostname}`);
		} catch (err) {
			logger.warn(`Couldn't remove Pangolin resource for ${hostname}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Live connectivity + auth check, for the Settings page's "Test
	 * connection" button : confirms the token can actually list the
	 * configured org's sites, rather than only validating it was non-blank.
	 */
	static async verifyConnection(
		baseUrl: string,
		token: string,
		orgId: string,
	): Promise<{ error?: string; success: boolean }> {
		try {
			const res = await fetch(
				`${baseUrl.replace(/\/$/, "")}/org/${orgId}/sites`,
				{ headers: { Authorization: `Bearer ${token}` } },
			);
			const body = (await res.json()) as {
				message?: string;
				success: boolean;
			};
			if (!(res.ok && body.success)) {
				return {
					error: body.message ?? `HTTP ${res.status}`,
					success: false,
				};
			}
			return { success: true };
		} catch (err) {
			return {
				error: err instanceof Error ? err.message : String(err),
				success: false,
			};
		}
	}
}
