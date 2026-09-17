import { config } from "$lib/config";

/**
 * The origin the browser actually used, honouring `X-Forwarded-Host` and
 * `X-Forwarded-Proto` from a reverse proxy before falling back to the request
 * URL.
 */
export function browserOrigin(request: Request, url: URL): string {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const host = forwardedHost ?? request.headers.get("host");
	if (!host) {
		return url.origin;
	}
	const proto =
		request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
	return `${proto}://${host}`;
}

/**
 * The configured auth origin when the browser reached this page on a different
 * origin, so sign-in can send it to the canonical one where auth cookies work.
 *
 * @returns Null when no auth origin is configured, it can't be parsed, or the
 * request is already on it.
 */
export function offCanonicalOrigin(request: Request, url: URL): string | null {
	if (!config.auth.origin) {
		return null;
	}
	let configured: URL;
	try {
		configured = new URL(config.auth.origin);
	} catch {
		return null;
	}
	return browserOrigin(request, url) === configured.origin
		? null
		: configured.origin;
}

/**
 * The origin the dashboard is served on : the configured Dashboard URL
 * (`auth.origin`) when set and parseable, else the origin the browser used for
 * this request.
 */
export function dashboardOrigin(request: Request, url: URL): string {
	if (config.auth.origin) {
		try {
			return new URL(config.auth.origin).origin;
		} catch {
			return browserOrigin(request, url);
		}
	}
	return browserOrigin(request, url);
}

/**
 * `link` moved onto the configured Dashboard URL, keeping its path and query.
 * better-auth builds email links from the request URL, which the server
 * adapter pins to the `ORIGIN` env var (the IP the installer detected), so a
 * link mailed after onboarding set a domain would otherwise point at the IP.
 *
 * @returns `link` unchanged when no Dashboard URL is set or either URL can't
 * be parsed.
 */
export function withDashboardOrigin(link: string): string {
	if (!config.auth.origin) {
		return link;
	}
	try {
		const target = new URL(config.auth.origin);
		const parsed = new URL(link);
		return `${target.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return link;
	}
}
