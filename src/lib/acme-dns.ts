import { createHmac } from "node:crypto";
import { stringify } from "yaml";
import { certificateCovers } from "#lib/tls-certificate.js";

export const ACME_DNS_PATH = "/api/acme-dns";
export const ACME_DNS_USERNAME = "homerun";
export const ACME_WILDCARD_ROUTER_FILE = "homerun-acme-wildcards.yml";

const PUBLIC_RESOLVERS = "1.1.1.1:53,8.8.8.8:53";
const DEFAULT_STORAGE = "/letsencrypt/acme.json";
const PROPAGATION_TIMEOUT_SECONDS = "600";
const POLLING_INTERVAL_SECONDS = "10";
const HTTP_TIMEOUT_SECONDS = "120";

export interface DnsChallengeSetup {
	endpoint: string;
	password: string;
	username: string;
}

/** The name of the DNS-01 resolver Homerun adds next to the HTTP-01 one called `resolver`. */
export function dnsChallengeResolver(resolver: string): string {
	return `${resolver}-dns`;
}

/** The Basic auth password Traefik's httpreq provider presents, derived from the auth secret so nothing new is stored. */
export function acmeDnsPassword(secret: string): string {
	return createHmac("sha256", secret)
		.update("homerun-acme-dns-challenge")
		.digest("hex");
}

/**
 * What Traefik needs to solve DNS-01 challenges through this app: the
 * endpoint at the origin Traefik already reaches it on for forwardAuth
 * (`authCheckUrl`), and the credentials it sends. Null when that URL doesn't
 * parse.
 */
export function dnsChallengeSetup(
	authCheckUrl: string,
	secret: string,
): DnsChallengeSetup | null {
	try {
		return {
			endpoint: `${new URL(authCheckUrl).origin}${ACME_DNS_PATH}`,
			password: acmeDnsPassword(secret),
			username: ACME_DNS_USERNAME,
		};
	} catch {
		return null;
	}
}

/** The bare, lowercased hostname of a challenge record's FQDN (`_acme-challenge.example.com.`). */
export function challengeHostname(fqdn: string): string {
	return fqdn.trim().toLowerCase().replace(/\.$/, "");
}

/** The most specific of `domains` that `host` is or falls under, null when none. */
export function challengeDomainFor(
	host: string,
	domains: string[],
): string | null {
	const target = challengeHostname(host);
	return (
		domains
			.filter((domain) => target === domain || target.endsWith(`.${domain}`))
			.sort((a, b) => b.length - a.length)[0] ?? null
	);
}

/**
 * The names a DNS-challenge domain's one certificate covers: the domain, its
 * first-level subdomains and, when the services subdomain sits below it,
 * that subdomain's too, so every default service hostname shares it.
 */
export function wildcardNames(domain: string, serviceDomain: string): string[] {
	const names = [domain, `*.${domain}`];
	if (serviceDomain !== domain && serviceDomain.endsWith(`.${domain}`)) {
		names.push(`*.${serviceDomain}`);
	}
	return names;
}

/**
 * The resolver a router for `host` takes when `host` sits under one of the
 * DNS-challenge `domains`: none when the domain's wildcard certificate
 * covers it (Traefik serves that from its store), the DNS-01 resolver for a
 * deeper name, and `undefined` when no DNS-challenge domain covers it.
 */
export function dnsChallengeResolverFor(
	host: string,
	resolver: string,
	domains: string[],
	serviceDomain: string,
): string | null | undefined {
	const domain = challengeDomainFor(host, domains);
	if (!domain) {
		return undefined;
	}
	return certificateCovers(wildcardNames(domain, serviceDomain), host)
		? null
		: dnsChallengeResolver(resolver);
}

/** The value of `--key=value` in a Traefik command line, matched case-insensitively. */
function flagValue(cmd: string[], key: string): string | null {
	const prefix = `--${key.toLowerCase()}=`;
	const arg = cmd.find((candidate) =>
		candidate.toLowerCase().startsWith(prefix),
	);
	return arg ? arg.slice(prefix.length) : null;
}

/**
 * The Traefik flags declaring the DNS-01 resolver, through lego's httpreq
 * provider, sharing the HTTP-01 resolver's storage file and account email
 * (read off the running command, `acmeEmail` winning when set), or every one
 * of them nulled so `applyFlags` removes it when `enabled` is false.
 */
export function dnsChallengeFlags(
	resolver: string,
	enabled: boolean,
	cmd: string[],
	acmeEmail: string | null,
): Record<string, string | null> {
	const prefix = `certificatesresolvers.${dnsChallengeResolver(resolver)}.acme`;
	const http = `certificatesresolvers.${resolver}.acme`;
	const email = acmeEmail ?? flagValue(cmd, `${http}.email`);
	return {
		[`${prefix}.dnschallenge.provider`]: enabled ? "httpreq" : null,
		[`${prefix}.dnschallenge.resolvers`]: enabled ? PUBLIC_RESOLVERS : null,
		[`${prefix}.email`]: enabled && email ? email : null,
		[`${prefix}.storage`]: enabled
			? (flagValue(cmd, `${http}.storage`) ?? DEFAULT_STORAGE)
			: null,
	};
}

/** The environment lego's httpreq provider reads inside Traefik, every variable nulled without a setup. */
export function httpreqEnv(
	setup: DnsChallengeSetup | null,
): Record<string, string | null> {
	return {
		HTTPREQ_ENDPOINT: setup?.endpoint ?? null,
		HTTPREQ_HTTP_TIMEOUT: setup ? HTTP_TIMEOUT_SECONDS : null,
		HTTPREQ_PASSWORD: setup?.password ?? null,
		HTTPREQ_POLLING_INTERVAL: setup ? POLLING_INTERVAL_SECONDS : null,
		HTTPREQ_PROPAGATION_TIMEOUT: setup ? PROPAGATION_TIMEOUT_SECONDS : null,
		HTTPREQ_USERNAME: setup?.username ?? null,
	};
}

/** A container's `KEY=value` environment with `changes` set, a null removing its variable; order kept, new ones appended. */
export function applyEnv(
	env: string[],
	changes: Record<string, string | null>,
): string[] {
	const keyOf = (entry: string) => entry.split("=")[0] ?? "";
	const next = env
		.filter((entry) => changes[keyOf(entry)] !== null)
		.map((entry) => {
			const value = changes[keyOf(entry)];
			return value === undefined ? entry : `${keyOf(entry)}=${value}`;
		});
	for (const [key, value] of Object.entries(changes)) {
		if (value !== null && !env.some((entry) => keyOf(entry) === key)) {
			next.push(`${key}=${value}`);
		}
	}
	return next;
}

/**
 * The Traefik dynamic config that makes the DNS-01 resolver issue one
 * wildcard certificate per DNS-challenge domain: a router per domain on a
 * hostname nothing serves, whose `tls.domains` asks for the certificate.
 * Every other router under the domain then carries `tls` with no resolver
 * and gets it from Traefik's store. Null with no domain.
 */
export function acmeWildcardRouterConfig(params: {
	domains: string[];
	entrypoint: string;
	resolver: string;
	serviceDomain: string;
}): string | null {
	if (params.domains.length === 0) {
		return null;
	}
	const routers = Object.fromEntries(
		params.domains.map((domain) => {
			const [main, ...sans] = wildcardNames(domain, params.serviceDomain);
			return [
				`homerun-acme-wildcard-${domain.replaceAll(".", "-")}`,
				{
					entryPoints: [params.entrypoint],
					rule: `Host(\`_acme-wildcard.${domain}\`)`,
					service: "noop@internal",
					tls: {
						certResolver: dnsChallengeResolver(params.resolver),
						domains: [{ main, sans }],
					},
				},
			];
		}),
	);
	return stringify({ http: { routers } });
}
