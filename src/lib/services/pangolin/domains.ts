export interface PangolinDomain {
	baseDomain: string;
	domainId: string;
	type?: string | null;
	verified?: boolean;
}

export interface PangolinDomainMatch {
	domain: PangolinDomain;
	subdomain: string | null;
}

/**
 * Which scheme Pangolin's tunnel speaks to this host's Traefik. `method` is
 * a free-form nullable string in the Integration API's own OpenAPI document
 * (`/resource/{id}/target`), carrying the target's scheme.
 */
export function targetScheme(port: number): "http" | "https" {
	return port === 80 ? "http" : "https";
}

/**
 * Picks the registered Pangolin domain that would route `hostname`, the way
 * Pangolin's own `validateAndConstructDomain` builds a resource's full domain:
 * a `cname` domain only ever routes its exact base domain, `ns` and
 * `wildcard` domains route it and any name below it. The most specific
 * (longest) match wins, so `apps.example.com` beats `example.com`. The
 * subdomain is null for the base domain itself, since a `wildcard` domain
 * turns an empty-string subdomain into `.example.com`.
 */
export function matchPangolinDomain(
	hostname: string,
	domains: PangolinDomain[],
): PangolinDomainMatch | null {
	const host = hostname.toLowerCase();
	const [domain] = domains
		.filter((candidate) => {
			const base = candidate.baseDomain.toLowerCase();
			if (host === base) {
				return true;
			}
			return candidate.type !== "cname" && host.endsWith(`.${base}`);
		})
		.sort((left, right) => right.baseDomain.length - left.baseDomain.length);
	if (!domain) {
		return null;
	}
	const base = domain.baseDomain.toLowerCase();
	const subdomain = host === base ? null : host.slice(0, -`.${base}`.length);
	return { domain, subdomain };
}
