import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import type { DnsSyncResult } from "./dns-result";

const logger = new Logger("Cloudflare");

const API_BASE = "https://api.cloudflare.com/client/v4";

export const CLOUDFLARE_MANAGED_COMMENT = "Managed by Homerun";

interface CloudflareError {
	code: number;
	message: string;
}

interface CloudflareEnvelope<T> {
	errors?: CloudflareError[];
	result: T;
	success: boolean;
}

interface CloudflareDnsRecord {
	comment?: string | null;
	content: string;
	id: string;
	name: string;
	ttl: number;
	type: string;
}

interface CloudflareZone {
	name: string;
	status: string;
}

export interface CloudflareVerifyResult {
	detail?: string;
	error?: string;
	success: boolean;
}

/** Lowercases a DNS name and drops a trailing root dot, so two spellings of one name compare equal. */
function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/\.$/, "");
}

/** Whether `hostname` is the zone apex or any name below it. */
export function hostnameInZone(hostname: string, zoneName: string): boolean {
	const host = normalizeName(hostname);
	const zone = normalizeName(zoneName);
	return host === zone || host.endsWith(`.${zone}`);
}

/** Renders Cloudflare's `errors[]` envelope as `[code] message` pairs, or null when it carries none. */
export function formatCloudflareErrors(
	errors: CloudflareError[] | undefined,
): string | null {
	if (!errors?.length) {
		return null;
	}
	return errors.map((error) => `[${error.code}] ${error.message}`).join("; ");
}

/** An HTTP or envelope-level failure from the Cloudflare API, keeping the status so a caller can treat a 404 as "already gone". */
class CloudflareApiError extends Error {
	readonly status: number;

	/** Wraps one failed call's HTTP status and rendered message. */
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Auto-manages DNS records for deployed services via Cloudflare's v4 REST
 * API : a service with `dnsResolvable` gets its `<slug>.<baseDomain>`
 * hostname created/kept as a CNAME record pointing at `baseDomain`, instead
 * of the admin adding one by hand every time. Built from Cloudflare's own
 * documented API shapes, same "not live-tested against a real registered
 * account" posture as the git-provider OAuth integration : verify the first
 * real sync by hand once a zone/token is configured.
 *
 * Deliberately re-reads instance settings itself on every call rather than
 * caching them on the instance :
 * the token/zone can change on /settings mid-session, and DNS syncs are
 * infrequent (once per deploy), so there's no meaningful state worth
 * caching here.
 */
class CloudflareServiceClass {
	/**
	 * Shared authenticated fetch against the Cloudflare v4 API, unwrapping the
	 * `{success, errors, result}` envelope.
	 *
	 * @throws CloudflareApiError when the status isn't ok, the envelope says
	 *   `success: false`, or the body isn't JSON (an edge error page), naming
	 *   the `Retry-After` delay on a 429.
	 */
	private async request<T>(
		token: string,
		path: string,
		init?: RequestInit,
	): Promise<T> {
		const response = await fetch(`${API_BASE}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...Object.fromEntries(new Headers(init?.headers)),
			},
		});
		const raw = await response.text();
		let body: CloudflareEnvelope<T> | null = null;
		try {
			body = raw ? (JSON.parse(raw) as CloudflareEnvelope<T>) : null;
		} catch {
			body = null;
		}
		const retryAfter = response.headers.get("retry-after");
		const rateLimited =
			response.status === 429
				? ` (rate limited, retry in ${retryAfter ?? "a few"} seconds)`
				: "";
		if (!body) {
			throw new CloudflareApiError(
				response.status,
				`Cloudflare API ${response.status} returned no JSON body${rateLimited}`,
			);
		}
		if (!(response.ok && body.success)) {
			throw new CloudflareApiError(
				response.status,
				`Cloudflare API ${response.status}: ${formatCloudflareErrors(body.errors) ?? "request failed"}${rateLimited}`,
			);
		}
		return body.result;
	}

	/** The zone's own record, whose `name` bounds which hostnames it can hold. */
	private getZone(token: string, zoneId: string): Promise<CloudflareZone> {
		return this.request<CloudflareZone>(token, `/zones/${zoneId}`);
	}

	/** Every record in the zone named exactly `hostname`, of any type. */
	private async recordsNamed(
		token: string,
		zoneId: string,
		hostname: string,
	): Promise<CloudflareDnsRecord[]> {
		const params = new URLSearchParams({
			"name.exact": hostname,
			per_page: "100",
		});
		const records = await this.request<CloudflareDnsRecord[]>(
			token,
			`/zones/${zoneId}/dns_records?${params}`,
		);
		return records.filter(
			(record) => normalizeName(record.name) === normalizeName(hostname),
		);
	}

	/** The decrypted token and zone id, or null when the integration is off. */
	private async credentialsOrNull(): Promise<{
		token: string;
		zoneId: string;
	} | null> {
		const settings = await InstanceSettingsDTO.get();
		if (!settings.cloudflareConfigured) {
			return null;
		}
		const token = settings.decryptCloudflareApiToken();
		const zoneId = settings.cloudflareZoneId;
		return token && zoneId ? { token, zoneId } : null;
	}

	/**
	 * Makes `hostname` a CNAME to `target` (this instance's own `baseDomain`).
	 * Idempotent: a record that already points at `target` is left untouched,
	 * one pointing elsewhere is patched with its new `content` plus the schema's
	 * required name/type/ttl echoed back (so a proxied flag, TTL or comment set
	 * by hand survives), and a new one is created unproxied
	 * with automatic TTL and a "Managed by Homerun" comment. Never overwrites
	 * an A/AAAA record on the same name (reported as a failure), and skips, as
	 * a success, a hostname outside the zone or equal to `target`. Never throws: the outcome is reported instead.
	 */
	async syncDnsRecord(
		hostname: string,
		target: string,
	): Promise<DnsSyncResult | null> {
		const credentials = await this.credentialsOrNull();
		if (!credentials) {
			return null;
		}
		const { token, zoneId } = credentials;

		if (normalizeName(hostname) === normalizeName(target)) {
			return {
				detail: `skipped, ${hostname} is the CNAME target itself`,
				ok: true,
				provider: "cloudflare",
			};
		}

		try {
			const zone = await this.getZone(token, zoneId);
			if (!hostnameInZone(hostname, zone.name)) {
				return {
					detail: `skipped, ${hostname} is outside the Cloudflare zone ${zone.name}`,
					ok: true,
					provider: "cloudflare",
				};
			}

			const records = await this.recordsNamed(token, zoneId, hostname);
			const cname = records.find((record) => record.type === "CNAME");
			if (!cname) {
				const conflict = records.find(
					(record) => record.type === "A" || record.type === "AAAA",
				);
				if (conflict) {
					return {
						detail: `an ${conflict.type} record already exists for ${hostname} (${conflict.content}), left alone`,
						ok: false,
						provider: "cloudflare",
					};
				}
				await this.request(token, `/zones/${zoneId}/dns_records`, {
					body: JSON.stringify({
						comment: CLOUDFLARE_MANAGED_COMMENT,
						content: target,
						name: hostname,
						proxied: false,
						ttl: 1,
						type: "CNAME",
					}),
					method: "POST",
				});
				logger.info(`DNS record created: ${hostname} -> ${target}`);
				return {
					detail: `created CNAME ${hostname} -> ${target}`,
					ok: true,
					provider: "cloudflare",
				};
			}

			if (normalizeName(cname.content) === normalizeName(target)) {
				return {
					detail: `CNAME ${hostname} -> ${target} already in place`,
					ok: true,
					provider: "cloudflare",
				};
			}
			await this.request(token, `/zones/${zoneId}/dns_records/${cname.id}`, {
				body: JSON.stringify({
					content: target,
					name: cname.name,
					ttl: cname.ttl,
					type: "CNAME",
				}),
				method: "PATCH",
			});
			logger.info(
				`DNS record updated: ${hostname} -> ${target} (was ${cname.content})`,
			);
			return {
				detail: `updated CNAME ${hostname} -> ${target} (was ${cname.content})`,
				ok: true,
				provider: "cloudflare",
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn(`Couldn't sync DNS record for ${hostname}`, {
				error: detail,
			});
			return { detail, ok: false, provider: "cloudflare" };
		}
	}

	/**
	 * Removes the CNAME for `hostname` when a service is deleted, but only one
	 * Homerun plausibly owns: pointing at `target` or carrying the managed
	 * comment. A record already gone, before the lookup or between lookup and
	 * delete (a 404), counts as success. Never throws.
	 */
	async deleteDnsRecord(
		hostname: string,
		target: string,
	): Promise<DnsSyncResult | null> {
		const credentials = await this.credentialsOrNull();
		if (!credentials) {
			return null;
		}
		const { token, zoneId } = credentials;

		try {
			const records = await this.recordsNamed(token, zoneId, hostname);
			const cname = records.find((record) => record.type === "CNAME");
			if (!cname) {
				return {
					detail: `no record for ${hostname}`,
					ok: true,
					provider: "cloudflare",
				};
			}
			const owned =
				normalizeName(cname.content) === normalizeName(target) ||
				cname.comment === CLOUDFLARE_MANAGED_COMMENT;
			if (!owned) {
				return {
					detail: `left CNAME ${hostname} -> ${cname.content} alone, Homerun didn't create it`,
					ok: true,
					provider: "cloudflare",
				};
			}
			try {
				await this.request(token, `/zones/${zoneId}/dns_records/${cname.id}`, {
					method: "DELETE",
				});
			} catch (error) {
				if (!(error instanceof CloudflareApiError && error.status === 404)) {
					throw error;
				}
			}
			logger.info(`DNS record removed: ${hostname}`);
			return {
				detail: `removed ${hostname}`,
				ok: true,
				provider: "cloudflare",
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.warn(`Couldn't remove DNS record for ${hostname}`, {
				error: detail,
			});
			return { detail, ok: false, provider: "cloudflare" };
		}
	}

	/**
	 * Live check for the "Test connection" button: the token can read the
	 * zone, the zone is active, the token can list its DNS records, and, when
	 * `baseDomain` is given, the zone actually holds it. Write access can't be
	 * proven without writing, so a read-only token still passes here.
	 */
	async verifyZoneAccess(
		token: string,
		zoneId: string,
		baseDomain?: string | null,
	): Promise<CloudflareVerifyResult> {
		try {
			const zone = await this.getZone(token, zoneId);
			if (baseDomain && !hostnameInZone(baseDomain, zone.name)) {
				return {
					error: `Zone ${zone.name} doesn't hold the base domain ${baseDomain}.`,
					success: false,
				};
			}
			await this.request<CloudflareDnsRecord[]>(
				token,
				`/zones/${zoneId}/dns_records?per_page=1`,
			);
			const pending =
				zone.status === "active" ? "" : `, zone status is ${zone.status}`;
			return {
				detail: `zone ${zone.name}, DNS records readable${pending}`,
				success: true,
			};
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
				success: false,
			};
		}
	}
}

export const CloudflareService = new CloudflareServiceClass();
