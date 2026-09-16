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
