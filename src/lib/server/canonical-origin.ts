import { config } from "$lib/config";

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
