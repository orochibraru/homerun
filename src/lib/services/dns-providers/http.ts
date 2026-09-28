import type { DnsZone } from "./types";

/** A failed call to a DNS provider's API, keeping the HTTP status so a caller can treat a 404 on delete as "already gone". */
export class DnsProviderError extends Error {
	readonly status: number;

	/** Wraps one failed call's HTTP status and readable message. */
	constructor(status: number, message: string) {
		super(message);
		this.name = "DnsProviderError";
		this.status = status;
	}
}

/** Lowercases a DNS name and drops a trailing root dot, so two spellings of one name compare equal. */
export function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/\.$/, "");
}

/** Whether `name` is the zone apex or any name below it. */
export function inZone(name: string, zoneName: string): boolean {
	const host = normalizeName(name);
	const zone = normalizeName(zoneName);
	return host === zone || host.endsWith(`.${zone}`);
}

/**
 * A record name relative to its zone, as most provider APIs want it: `@` for
 * the apex, `app` for `app.example.com`.
 *
 * @throws When the name isn't in the zone.
 */
export function relativeName(name: string, zone: DnsZone): string {
	const host = normalizeName(name);
	const apex = normalizeName(zone.name);
	if (host === apex) {
		return "@";
	}
	if (!host.endsWith(`.${apex}`)) {
		throw new DnsProviderError(400, `${name} isn't in the ${zone.name} zone.`);
	}
	return host.slice(0, -(apex.length + 1));
}

/** A record name from a provider's relative one (`@`, empty, or a label) back to a full name. */
export function absoluteName(name: string, zone: DnsZone): string {
	const host = normalizeName(name);
	const apex = normalizeName(zone.name);
	if (!host || host === "@" || host === apex) {
		return apex;
	}
	return host.endsWith(`.${apex}`) ? host : `${host}.${apex}`;
}

/** A CNAME, MX or similar target as a bare hostname, without the trailing root dot some APIs add. */
export function bareTarget(content: string): string {
	return content.trim().replace(/\.$/, "");
}

/**
 * One call to a DNS provider's API: sends `init`, parses a JSON answer (an
 * empty one is `null`), and turns anything but a 2xx into a
 * `DnsProviderError` whose message is `provider status: detail`, the detail
 * picked out of the body by `describe` when given, else its raw text. A 429
 * names the `Retry-After` delay.
 *
 * @throws DnsProviderError on a non-2xx status, or a 2xx body that isn't JSON.
 */
export async function providerRequest<T>(
	provider: string,
	url: string,
	init: RequestInit = {},
	describe?: (body: unknown) => string | null,
): Promise<T> {
	const response = await fetch(url, init);
	const raw = await response.text();
	let body: unknown = null;
	let parsed = true;
	try {
		body = raw ? JSON.parse(raw) : null;
	} catch {
		parsed = false;
	}
	if (!response.ok) {
		const detail =
			(parsed ? describe?.(body) : null) ??
			(raw.trim().slice(0, 300) || response.statusText || "request failed");
		const retry =
			response.status === 429
				? ` (rate limited, retry in ${response.headers.get("retry-after") ?? "a few"} seconds)`
				: "";
		throw new DnsProviderError(
			response.status,
			`${provider} ${response.status}: ${detail}${retry}`,
		);
	}
	if (!parsed) {
		throw new DnsProviderError(
			response.status,
			`${provider} ${response.status}: the answer isn't JSON`,
		);
	}
	return body as T;
}
