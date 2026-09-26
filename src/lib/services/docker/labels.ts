import { config } from "$lib/config";
import { serviceHostnames } from "$lib/service-domains";
import { certResolverFor } from "./cert-resolver.ts";

export const GATE_IDENTITY_HEADERS = [
	"X-Homerun-User",
	"X-Homerun-Email",
	"X-Homerun-Name",
];

/** The forwardAuth address Traefik should call to gate a service's router, `config.authCheckUrl` with `service` appended as a query param. */
export function authCheckUrlFor(serviceId: string): string {
	const separator = config.authCheckUrl.includes("?") ? "&" : "?";
	return `${config.authCheckUrl}${separator}service=${encodeURIComponent(serviceId)}`;
}

/**
 * Every container this app creates is tagged with these two labels.
 * `listManagedContainers()` (see service.ts) always filters on
 * MANAGED_LABEL : this app must never list, inspect, or touch a
 * container on the host that it didn't create itself.
 */
export function hasTraefikRouterFor(
	labels: Record<string, string>,
	host: string,
): boolean {
	if (labels["traefik.enable"] !== "true") {
		return false;
	}
	return Object.entries(labels).some(
		([key, value]) =>
			key.startsWith("traefik.http.routers.") &&
			key.endsWith(".rule") &&
			value.includes(host),
	);
}

export const RETRY_ATTEMPTS = 4;
export const RETRY_INITIAL_INTERVAL = "100ms";

export const MANAGED_LABEL = "homerun.managed";
export const SERVICE_ID_LABEL = "homerun.service.id";

/**
 * Builds the full label set for a container/swarm service : always the
 * `homerun.managed`/`homerun.service.id` tracking labels, plus (when
 * `dnsResolvable`) one Traefik router per routed hostname (the default
 * `<slug>.<baseDomain>` unless it was turned off, then each of `domains`), each
 * pointing at a Traefik service for its port (`<slug>` for `containerPort`,
 * `<slug>-<port>` for a domain `domainPorts` sends elsewhere), and, only when
 * `authRequired`, the login wall's forwardAuth middleware on every router: an
 * ungated service never calls back into Homerun, so it costs the dashboard
 * nothing per request and keeps serving while Homerun is down. Turning the
 * wall on or off therefore needs a redeploy, which saving it queues. A retry
 * middleware follows, so a
 * request that reaches a container or swarm task that just went away during a
 * rollout is sent to another one; Traefik only retries when no request bytes
 * reached the backend. With `httpCacheTtl` set and the instance's HTTP cache
 * plugin loaded, a Souin cache middleware follows both, keyed on the Cookie
 * and Authorization headers so one session's pages are never served to
 * another.
 */
export function buildContainerLabels(params: {
	authRequired?: boolean;
	containerPort: number;
	defaultDomainEnabled?: boolean;
	domainPorts?: Record<string, number>;
	httpCacheTtl?: number | null;
	dnsResolvable?: boolean;
	domains?: string[];
	networkName?: string;
	serviceId: string;
	slug: string;
	stackSlug?: string | null;
}): Record<string, string> {
	const {
		serviceId,
		slug,
		containerPort,
		dnsResolvable = true,
		networkName = config.docker.networkName,
	} = params;

	const baseLabels = {
		[MANAGED_LABEL]: "true",
		[SERVICE_ID_LABEL]: serviceId,
	};

	const hostnames = serviceHostnames(
		{
			defaultDomainEnabled: params.defaultDomainEnabled ?? true,
			domains: params.domains ?? [],
			primaryDomain: null,
			slug,
		},
		params.stackSlug,
		config.baseDomain,
	);
	if (!dnsResolvable || hostnames.length === 0) {
		return baseLabels;
	}

	const authMiddleware = `${slug}-auth`;
	const retryMiddleware = `${slug}-retry`;
	const cacheMiddleware = `${slug}-cache`;
	const cached = Boolean(params.httpCacheTtl && config.traefik.httpCache);
	const gated = params.authRequired === true;
	const middlewares = [
		...(gated ? [authMiddleware] : []),
		retryMiddleware,
		...(cached ? [cacheMiddleware] : []),
	].join(",");
	const labels: Record<string, string> = {
		...baseLabels,
		"traefik.docker.network": networkName,
		"traefik.enable": "true",
		[`traefik.http.services.${slug}.loadbalancer.server.port`]:
			String(containerPort),
		[`traefik.http.middlewares.${retryMiddleware}.retry.attempts`]:
			String(RETRY_ATTEMPTS),
		[`traefik.http.middlewares.${retryMiddleware}.retry.initialinterval`]:
			RETRY_INITIAL_INTERVAL,
	};
	if (gated) {
		labels[`traefik.http.middlewares.${authMiddleware}.forwardauth.address`] =
			authCheckUrlFor(serviceId);
		labels[
			`traefik.http.middlewares.${authMiddleware}.forwardauth.authResponseHeaders`
		] = GATE_IDENTITY_HEADERS.join(",");
	}
	if (cached) {
		const souin = `traefik.http.middlewares.${cacheMiddleware}.plugin.souin`;
		labels[`${souin}.default_cache.ttl`] = `${params.httpCacheTtl}s`;
		labels[`${souin}.default_cache.key.headers[0]`] = "Cookie";
		labels[`${souin}.default_cache.key.headers[1]`] = "Authorization";
	}

	hostnames.forEach((hostname, index) => {
		const router = index === 0 ? slug : `${slug}-${index}`;
		labels[`traefik.http.routers.${router}.rule`] = `Host(\`${hostname}\`)`;
		labels[`traefik.http.routers.${router}.entrypoints`] =
			config.traefik.entrypoint;
		labels[`traefik.http.routers.${router}.tls`] = "true";
		const port = params.domainPorts?.[hostname] ?? containerPort;
		const service = port === containerPort ? slug : `${slug}-${port}`;
		labels[`traefik.http.services.${service}.loadbalancer.server.port`] =
			String(port);
		labels[`traefik.http.routers.${router}.service`] = service;
		labels[`traefik.http.routers.${router}.middlewares`] = middlewares;
		const resolver = certResolverFor(
			hostname,
			config.traefik.certResolver,
			config.pangolinEnabled,
		);
		if (resolver) {
			labels[`traefik.http.routers.${router}.tls.certresolver`] = resolver;
		}
	});

	return labels;
}

/**
 * Whether a running workload's login-wall routing no longer matches what a
 * deploy would give it today: a forwardAuth middleware on a service whose
 * wall is off (left by a deploy from before ungated services stopped getting
 * one), none on a gated service, or one pointing at an old check URL (the
 * dashboard's container name before the `homerun-auth` alias).
 */
export function loginWallDrifted(
	labels: Record<string, string>,
	expectedAddress: string | null,
): boolean {
	const addresses = Object.entries(labels)
		.filter(([key]) => key.endsWith(".forwardauth.address"))
		.map(([, value]) => value);
	if (expectedAddress === null) {
		return addresses.length > 0;
	}
	return (
		addresses.length === 0 ||
		addresses.some((address) => address !== expectedAddress)
	);
}
