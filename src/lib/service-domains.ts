export const DOMAIN_RE =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface ServiceDomainFields {
	defaultDomainEnabled: boolean;
	domains: string[];
	primaryDomain: string | null;
	slug: string;
}

/** The `<slug>.<baseDomain>` hostname every public service gets, prefixed with its stack's slug when it has one. */
export function defaultHostname(
	slug: string,
	stackSlug: string | null | undefined,
	baseDomain: string,
): string {
	return `${stackSlug ? `${stackSlug}-${slug}` : slug}.${baseDomain}`;
}

/** Every hostname Traefik routes to the service: the default one first when it's kept, then the service's own domains. */
export function serviceHostnames(
	svc: ServiceDomainFields,
	stackSlug: string | null | undefined,
	baseDomain: string,
): string[] {
	return [
		...(svc.defaultDomainEnabled
			? [defaultHostname(svc.slug, stackSlug, baseDomain)]
			: []),
		...svc.domains,
	];
}

/** The hostname shown as the service's link: its chosen main domain while that's still routed, else the first routed one. Null when nothing is routed. */
export function primaryHostname(
	svc: ServiceDomainFields,
	stackSlug: string | null | undefined,
	baseDomain: string,
): string | null {
	const hostnames = serviceHostnames(svc, stackSlug, baseDomain);
	if (svc.primaryDomain && hostnames.includes(svc.primaryDomain)) {
		return svc.primaryDomain;
	}
	return hostnames[0] ?? null;
}

/** Whether `hostname` is `baseDomain` itself or one of its subdomains. */
export function isUnderDomain(hostname: string, baseDomain: string): boolean {
	return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
}

/** Trims, lowercases, drops blanks and duplicates, keeping the first occurrence's order. */
export function normalizeDomains(raw: readonly string[]): string[] {
	return [
		...new Set(
			raw.map((domain) => domain.trim().toLowerCase()).filter(Boolean),
		),
	];
}
