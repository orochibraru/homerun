import { config } from "$lib/config";
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

export const MANAGED_LABEL = "homerun.managed";
export const SERVICE_ID_LABEL = "homerun.service.id";

/**
 * Builds the full label set for a container/swarm service : always the
 * `homerun.managed`/`homerun.service.id` tracking labels, plus (when
 * `dnsResolvable`) the Traefik router/service/TLS labels that give it its
 * public `<slug>.<baseDomain>` route, a second router for `customDomain`
 * sharing the same backend, and the login wall's forwardAuth middleware on every
 * router. The middleware is attached whether or not the wall is on: auth-check
 * lets requests through for a service whose wall is off, so toggling it applies
 * without a redeploy.
 */
export function buildContainerLabels(params: {
	serviceId: string;
	slug: string;
	containerPort: number;
	// When false, no Traefik labels are attached at all : Traefik's docker
	// provider runs with exposedbydefault=false (see compose.yaml), so an
	// absent "traefik.enable" label means the container never gets a
	// router: no public <slug>.<baseDomain>, subnet-only reachability.
	dnsResolvable?: boolean;
	// When set, prefixes the public subdomain: "<stackSlug>-<slug>.<baseDomain>".
	stackSlug?: string | null;
	// Optional second hostname routed to the same backend : its own router,
	// sharing the primary router's Traefik service (no duplicated backend
	// config). Only applied when dnsResolvable is true.
	customDomain?: string | null;
	// Which network Traefik should reach this workload on. Defaults to the
	// shared bridge network every standalone container joins; swarm-mode
	// services pass their own overlay instead (see docker/swarm.ts).
	networkName?: string;
}): Record<string, string> {
	const {
		serviceId,
		slug,
		containerPort,
		dnsResolvable = true,
		stackSlug,
		customDomain,
		networkName = config.docker.networkName,
	} = params;

	const baseLabels = {
		[MANAGED_LABEL]: "true",
		[SERVICE_ID_LABEL]: serviceId,
	};

	if (!dnsResolvable) {
		return baseLabels;
	}

	const host = stackSlug ? `${stackSlug}-${slug}` : slug;
	const hostname = `${host}.${config.baseDomain}`;
	const resolverFor = (name: string) =>
		certResolverFor(name, config.traefik.certResolver, config.pangolinEnabled);
	const primaryResolver = resolverFor(hostname);

	const labels: Record<string, string> = {
		...baseLabels,
		"traefik.docker.network": networkName,

		// Traefik auto-discovers this container via the Docker provider :
		// no control-plane push required. See compose.yaml for how Traefik
		// itself is bootstrapped.
		"traefik.enable": "true",
		[`traefik.http.routers.${slug}.rule`]: `Host(\`${hostname}\`)`,
		[`traefik.http.routers.${slug}.entrypoints`]: config.traefik.entrypoint,
		[`traefik.http.routers.${slug}.tls`]: "true",
		[`traefik.http.services.${slug}.loadbalancer.server.port`]:
			String(containerPort),
	};

	if (primaryResolver) {
		labels[`traefik.http.routers.${slug}.tls.certresolver`] = primaryResolver;
	}

	if (customDomain) {
		const customRouter = `${slug}-custom`;
		labels[`traefik.http.routers.${customRouter}.rule`] =
			`Host(\`${customDomain}\`)`;
		labels[`traefik.http.routers.${customRouter}.entrypoints`] =
			config.traefik.entrypoint;
		labels[`traefik.http.routers.${customRouter}.tls`] = "true";
		const customResolver = resolverFor(customDomain);
		if (customResolver) {
			labels[`traefik.http.routers.${customRouter}.tls.certresolver`] =
				customResolver;
		}
		// Reuses the primary router's service : same backend, just a second
		// hostname reaching it, not a duplicated loadbalancer config.
		labels[`traefik.http.routers.${customRouter}.service`] = slug;
	}

	const authMiddleware = `${slug}-auth`;
	labels[`traefik.http.middlewares.${authMiddleware}.forwardauth.address`] =
		authCheckUrlFor(serviceId);
	labels[
		`traefik.http.middlewares.${authMiddleware}.forwardauth.authResponseHeaders`
	] = GATE_IDENTITY_HEADERS.join(",");
	labels[`traefik.http.routers.${slug}.middlewares`] = authMiddleware;
	if (customDomain) {
		labels[`traefik.http.routers.${slug}-custom.middlewares`] = authMiddleware;
	}

	return labels;
}
