import { DOMAIN_RE } from "#lib/service-domains.js";

export const REDIRECTS_FILE = "homerun-redirects.yml";

export const REDIRECT_ROUTER_PRIORITY = 9500;

export interface RedirectRule {
	destination: string;
	enabled: boolean;
	id: string;
	keepPath: boolean;
	permanent: boolean;
	source: string;
}

/** Escapes `text` for a Go regular expression (Traefik's `redirectRegex`). */
export function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits a redirect source (`old.example.com` or `example.com/blog`) into
 * its lowercase host and its path prefix (empty, or starting with `/` and
 * without a trailing one), or null when it isn't a valid source.
 */
export function splitSource(
	source: string,
): { host: string; pathPrefix: string } | null {
	const trimmed = source.trim().toLowerCase();
	const slash = trimmed.indexOf("/");
	const host = slash === -1 ? trimmed : trimmed.slice(0, slash);
	const pathPrefix =
		slash === -1 ? "" : trimmed.slice(slash).replace(/\/+$/, "");
	if (!DOMAIN_RE.test(host) || /[\s`?#\\]/.test(pathPrefix)) {
		return null;
	}
	return { host, pathPrefix };
}

/** The canonical stored form of a source : lowercase host plus its path prefix, no trailing slash. */
export function normalizeSource(source: string): string | null {
	const parts = splitSource(source);
	return parts ? `${parts.host}${parts.pathPrefix}` : null;
}

/** The destination as a bare `http(s)://…` URL, or null when it isn't one. */
export function normalizeDestination(destination: string): string | null {
	try {
		const url = new URL(destination.trim());
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

/**
 * The `redirectRegex` pair for one redirect. The regex is matched against
 * the full request URL. With `keepPath` the part after the source (path
 * remainder plus query string) is appended to the destination; otherwise the
 * destination is used exactly. A `$` in the destination is doubled, since
 * Traefik expands `$name` in a replacement.
 */
export function redirectRegexFor(rule: RedirectRule): {
	regex: string;
	replacement: string;
} | null {
	const parts = splitSource(rule.source);
	if (!parts) {
		return null;
	}
	const head = `^https?://${escapeRegex(parts.host)}(?::\\d+)?${escapeRegex(parts.pathPrefix)}`;
	if (rule.keepPath) {
		return {
			regex: `${head}((?:[/?].*)?)$`,
			replacement: `${rule.destination.replace(/\/+$/, "").replaceAll("$", "$$$$")}\${1}`,
		};
	}
	return {
		regex: `${head}(?:[/?].*)?$`,
		replacement: rule.destination.replaceAll("$", "$$$$"),
	};
}

/** The Traefik router rule matching a redirect's host and optional path prefix. */
export function redirectRouterRule(host: string, pathPrefix: string): string {
	const hostRule = `Host(\`${host}\`)`;
	return pathPrefix
		? `${hostRule} && (Path(\`${pathPrefix}\`) || PathPrefix(\`${pathPrefix}/\`))`
		: hostRule;
}

/**
 * The Traefik dynamic config (JSON, which is valid YAML) with one router,
 * one `redirectRegex` middleware and the shared `noop@internal` service per
 * enabled redirect, or null when there's nothing to write. Each router sits
 * above a service's own routers, blocked paths and login-wall splits
 * included, so a redirect configured on a service's host still wins.
 */
export function redirectsConfig(
	rules: RedirectRule[],
	options: {
		certResolver: (host: string) => string | null;
		entrypoint: string;
	},
): string | null {
	const routers: Record<string, unknown> = {};
	const middlewares: Record<string, unknown> = {};
	for (const rule of rules) {
		const parts = splitSource(rule.source);
		const regex = redirectRegexFor(rule);
		if (!(rule.enabled && parts && regex)) {
			continue;
		}
		const name = `homerun-redirect-${rule.id}`;
		const resolver = options.certResolver(parts.host);
		middlewares[name] = {
			redirectRegex: { ...regex, permanent: rule.permanent },
		};
		routers[name] = {
			entryPoints: [options.entrypoint],
			middlewares: [name],
			priority: REDIRECT_ROUTER_PRIORITY,
			rule: redirectRouterRule(parts.host, parts.pathPrefix),
			service: "noop@internal",
			tls: resolver ? { certResolver: resolver } : {},
		};
	}
	if (Object.keys(routers).length === 0) {
		return null;
	}
	return JSON.stringify({ http: { middlewares, routers } }, null, 2);
}
