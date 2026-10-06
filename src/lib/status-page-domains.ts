import { DOMAIN_RE } from "#lib/service-domains.js";

export const STATUS_PAGES_FILE = "homerun-status-pages.yml";

export const STATUS_PAGE_ROUTER_PRIORITY = 9400;

export const STATUS_PAGE_SERVICE = "homerun-status-pages";

/** The paths a status page needs on its own domain: the page, its data, the app's assets and the icon. */
const PAGE_PATHS = (slug: string) =>
	[
		"Path(`/`)",
		`PathPrefix(\`/status/${slug}\`)`,
		"PathPrefix(`/_app/`)",
		"Path(`/favicon.svg`)",
		"Path(`/robots.txt`)",
	].join(" || ");

/**
 * A status page's custom domains, lowercased, trimmed and deduplicated, from
 * a list or one-per-line text, or why one of them can't be used.
 */
export function normalizeStatusDomains(
	raw: string | string[],
): { domains: string[] } | { error: string } {
	const items = (Array.isArray(raw) ? raw : raw.split(/[\s,]+/))
		.map((domain) => domain.trim().toLowerCase().replace(/\.$/, ""))
		.filter(Boolean);
	for (const domain of items) {
		if (!DOMAIN_RE.test(domain)) {
			return { error: `"${domain}" isn't a domain, e.g. status.example.com.` };
		}
	}
	return { domains: [...new Set(items)] };
}

export interface StatusPageRoute {
	domains: string[];
	isPublic: boolean;
	slug: string;
}

/**
 * The Traefik dynamic config serving each public status page on its own
 * domains: a router per domain sending only the page's paths to the app (so
 * the dashboard is never reachable there), a redirect from `/` to the page,
 * and one service pointing at the app. Null when no public page has a domain.
 */
export function statusPagesConfig(
	pages: StatusPageRoute[],
	options: {
		certResolverFor: (host: string) => string | null;
		entrypoint: string;
		target: string;
	},
): string | null {
	const routed = pages.filter(
		(page) => page.isPublic && page.domains.length > 0,
	);
	if (routed.length === 0) {
		return null;
	}
	const routers: string[] = [];
	const middlewares: string[] = [];
	for (const page of routed) {
		const redirect = `homerun-status-${page.slug}-root`;
		middlewares.push(
			`    ${redirect}:`,
			"      redirectRegex:",
			"        regex: '^(https?)://([^/]+)/?(\\?.*)?$'",
			`        replacement: '\${1}://\${2}/status/${page.slug}\${3}'`,
		);
		page.domains.forEach((domain, index) => {
			const resolver = options.certResolverFor(domain);
			routers.push(
				`    homerun-status-${page.slug}-${index}:`,
				`      rule: Host(\`${domain}\`) && (${PAGE_PATHS(page.slug)})`,
				`      priority: ${STATUS_PAGE_ROUTER_PRIORITY}`,
				"      entryPoints:",
				`        - ${options.entrypoint}`,
				"      middlewares:",
				`        - ${redirect}`,
				`      service: ${STATUS_PAGE_SERVICE}`,
				resolver
					? `      tls:\n        certResolver: ${resolver}`
					: "      tls: {}",
			);
		});
	}
	return [
		"http:",
		"  routers:",
		...routers,
		"  middlewares:",
		...middlewares,
		"  services:",
		`    ${STATUS_PAGE_SERVICE}:`,
		"      loadBalancer:",
		"        servers:",
		`          - url: ${options.target}`,
		"",
	].join("\n");
}
