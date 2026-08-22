import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Cloudflare");

const API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareDnsRecord {
	id: string;
}

interface CloudflareListResponse {
	result: CloudflareDnsRecord[];
	success: boolean;
}

interface CloudflareWriteResponse {
	errors: Array<{ message: string }>;
	success: boolean;
}

/**
 * Auto-manages DNS records for deployed services via Cloudflare's v4 REST
 * API : a service with `dnsResolvable` gets its `<slug>.<baseDomain>`
 * hostname created/kept as a CNAME record pointing at `baseDomain`, instead
 * of the admin adding one by hand every time. Built carefully from
 * Cloudflare's own documented API shapes, same "not live-tested against a
 * real registered account" posture as the git-provider OAuth integration :
 * verify the first real sync by hand once a zone/token is configured.
 *
 * Deliberately a plain class with static methods reading instance settings
 * itself on every call (not a singleton instance holding cached config) :
 * the token/zone can change on /settings mid-session, and DNS syncs are
 * infrequent (once per deploy), so there's no meaningful state worth
 * caching here.
 */
export class CloudflareService {
	private static async request<T>(
		token: string,
		path: string,
		init?: RequestInit,
	): Promise<T> {
		const res = await fetch(`${API_BASE}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});
		const body = (await res.json()) as T;
		if (!res.ok) {
			throw new Error(`Cloudflare API ${res.status}: ${JSON.stringify(body)}`);
		}
		return body;
	}

	private static async findRecordId(
		token: string,
		zoneId: string,
		hostname: string,
	): Promise<string | null> {
		const res = await CloudflareService.request<CloudflareListResponse>(
			token,
			`/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
		);
		return res.result[0]?.id ?? null;
	}

	/**
	 * Upserts a CNAME record for `hostname` -> `target` (this instance's own
	 * `baseDomain`, which must already resolve to this server for Traefik
	 * routing to work at all, same assumption the rest of this app makes).
	 * Best-effort : never throws into the deploy pipeline, logs and returns
	 * on any failure, a missed DNS sync isn't worth failing a deploy over,
	 * the admin can always add the record by hand.
	 */
	static async syncDnsRecord(hostname: string, target: string): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		if (!settings.cloudflareConfigured) {
			return;
		}
		const token = settings.decryptCloudflareApiToken();
		const zoneId = settings.cloudflareZoneId;
		if (!(token && zoneId)) {
			return;
		}

		try {
			const existingId = await CloudflareService.findRecordId(
				token,
				zoneId,
				hostname,
			);
			const body = JSON.stringify({
				content: target,
				name: hostname,
				proxied: false,
				ttl: 1,
				type: "CNAME",
			});
			const result = existingId
				? await CloudflareService.request<CloudflareWriteResponse>(
						token,
						`/zones/${zoneId}/dns_records/${existingId}`,
						{ body, method: "PUT" },
					)
				: await CloudflareService.request<CloudflareWriteResponse>(
						token,
						`/zones/${zoneId}/dns_records`,
						{ body, method: "POST" },
					);
			if (!result.success) {
				throw new Error(JSON.stringify(result.errors));
			}
			logger.info(
				`DNS record synced: ${hostname} -> ${target} (${existingId ? "updated" : "created"})`,
			);
		} catch (err) {
			logger.warn(`Couldn't sync DNS record for ${hostname}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/** Best-effort removal, same non-throwing posture as syncDnsRecord : called when a service with a Cloudflare-managed hostname is deleted. */
	static async deleteDnsRecord(hostname: string): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		if (!settings.cloudflareConfigured) {
			return;
		}
		const token = settings.decryptCloudflareApiToken();
		const zoneId = settings.cloudflareZoneId;
		if (!(token && zoneId)) {
			return;
		}

		try {
			const existingId = await CloudflareService.findRecordId(
				token,
				zoneId,
				hostname,
			);
			if (!existingId) {
				return;
			}
			await CloudflareService.request(
				token,
				`/zones/${zoneId}/dns_records/${existingId}`,
				{ method: "DELETE" },
			);
			logger.info(`DNS record removed: ${hostname}`);
		} catch (err) {
			logger.warn(`Couldn't remove DNS record for ${hostname}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Live connectivity + auth check, for the Settings page's "Test
	 * connection" button : confirms the token can actually read the
	 * configured zone, rather than only validating it was non-blank.
	 */
	static async verifyZoneAccess(
		token: string,
		zoneId: string,
	): Promise<{ error?: string; success: boolean }> {
		try {
			const res = await fetch(`${API_BASE}/zones/${zoneId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			const body = (await res.json()) as {
				errors: Array<{ message: string }>;
				result?: { name: string };
				success: boolean;
			};
			if (!res.ok || !body.success) {
				return {
					error: body.errors?.[0]?.message ?? `HTTP ${res.status}`,
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
