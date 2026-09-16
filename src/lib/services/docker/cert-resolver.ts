const IPV4_HOST_RE = /(^|\.)\d{1,3}(\.\d{1,3}){3}$/;
const LOCAL_HOST_RE = /(^|\.)localhost$/;

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
