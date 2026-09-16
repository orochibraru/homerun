const IPV4_HOST_RE = /(^|\.)\d{1,3}(\.\d{1,3}){3}$/;
const LOCAL_HOST_RE = /(^|\.)localhost$/;

/**
 * The Traefik cert resolver to attach to a router for `host`, or null when
 * none should be : behind Pangolin (which terminates TLS itself), no
 * resolver configured, or `host` is a bare hostname/IPv4/`localhost` that
 * ACME could never issue a certificate for anyway.
 */
export function certResolverFor(
	host: string,
	resolver: string,
	behindPangolin: boolean,
): string | null {
	if (
		behindPangolin ||
		!resolver ||
		!host.includes(".") ||
		IPV4_HOST_RE.test(host) ||
		LOCAL_HOST_RE.test(host)
	) {
		return null;
	}
	return resolver;
}
