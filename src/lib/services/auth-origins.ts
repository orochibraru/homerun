function originOf(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

/**
 * The origins better-auth should trust for this instance: the env-configured
 * origin and the auth origin themselves, plus both `http://` and `https://`
 * variants of the auth origin's host and the base domain (skipping
 * `localhost`, which is trusted implicitly). Used to build better-auth's
 * `trustedOrigins` list.
 */
export function trustedOriginsFor(params: {
	authOrigin: string | null | undefined;
	baseDomain: string;
	envOrigin: string | null | undefined;
}): string[] {
	const origins = new Set<string>();
	for (const value of [params.envOrigin, params.authOrigin]) {
		const origin = originOf(value);
		if (origin) {
			origins.add(origin);
		}
	}
	const authHost = originOf(params.authOrigin)
		? new URL(params.authOrigin as string).host
		: null;
	for (const host of [authHost, params.baseDomain]) {
		if (host && host !== "localhost") {
			origins.add(`https://${host}`);
			origins.add(`http://${host}`);
		}
	}
	return [...origins];
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The hostname part of a `Host` header, without its port or IPv6 brackets. */
function hostnameOf(host: string): string {
	if (host.startsWith("[")) {
		return host.slice(1, host.indexOf("]"));
	}
	return host.split(":")[0] ?? host;
}

/**
 * The origins to trust for a request sent straight to the instance's own
 * address rather than a domain: an IP literal or `localhost`, from the
 * request's `Host` header. This is the way back in when the Dashboard URL or
 * base domain is set to something that no longer routes here (a typo, a
 * domain change Traefik now maps elsewhere), since the published port still
 * answers on the server's IP. Trusting it is a same-origin check, not a
 * loosening: a cross-site page can't make a browser send another site's
 * `Host` header, so its `Origin` never matches. Named hosts are left to the
 * configured origins, since DNS rebinding could otherwise point one here.
 */
export function directAccessOrigins(host: string | null | undefined): string[] {
	return host && isDirectAccessHost(host)
		? [`http://${host}`, `https://${host}`]
		: [];
}

/** Whether a `Host` header names an IP literal or `localhost` rather than a domain. */
function isDirectAccessHost(host: string): boolean {
	const hostname = hostnameOf(host.trim().toLowerCase());
	return (
		hostname === "localhost" ||
		IPV4_RE.test(hostname) ||
		(hostname.includes(":") && /^[0-9a-f:.]+$/.test(hostname))
	);
}

export type DirectAccessScheme = "http" | "https";

/**
 * The scheme a request sent straight to the instance's own address arrived on,
 * so auth cookies can be issued to suit it instead of the configured origin:
 * a `Secure`/`__Secure-` cookie from an `https://` ORIGIN is dropped by the
 * browser over plain HTTP, and a cross-subdomain `Domain=.<baseDomain>` cookie
 * is rejected on an IP. Plain HTTP unless a proxy says `X-Forwarded-Proto:
 * https`, since the published port itself never terminates TLS.
 *
 * @returns Null for a named host, which keeps the configured cookies.
 */
export function directAccessScheme(
	host: string | null | undefined,
	forwardedProto: string | null | undefined,
): DirectAccessScheme | null {
	if (!(host && isDirectAccessHost(host))) {
		return null;
	}
	return forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https"
		? "https"
		: "http";
}
