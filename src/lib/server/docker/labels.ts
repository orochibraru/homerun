import { config } from "$lib/config";

/**
 * Every container this app creates is tagged with these two labels.
 * `listManagedContainers()` (see service.ts) always filters on
 * MANAGED_LABEL — this app must never list, inspect, or touch a
 * container on the host that it didn't create itself.
 */
export const MANAGED_LABEL = "homerun.managed";
export const SERVICE_ID_LABEL = "homerun.service.id";

export function buildContainerLabels(params: {
  serviceId: string;
  slug: string;
  containerPort: number;
  // When false, no Traefik labels are attached at all — Traefik's docker
  // provider runs with exposedbydefault=false (see compose.yaml), so an
  // absent "traefik.enable" label means the container never gets a
  // router: no public <slug>.<baseDomain>, subnet-only reachability.
  dnsResolvable?: boolean;
  // When set, prefixes the public subdomain: "<projectSlug>-<slug>.<baseDomain>".
  projectSlug?: string | null;
  // Optional second hostname routed to the same backend — its own router,
  // sharing the primary router's Traefik service (no duplicated backend
  // config). Only applied when dnsResolvable is true.
  customDomain?: string | null;
  // When true, gatekeeps every router for this service behind a Traefik
  // forwardAuth middleware pointing at config.authCheckUrl — see
  // /api/v1/auth-check. Only applied when dnsResolvable is true (a
  // subnet-only service has no public router to gate anyway).
  authRequired?: boolean;
}): Record<string, string> {
  const {
    serviceId,
    slug,
    containerPort,
    dnsResolvable = true,
    projectSlug,
    customDomain,
    authRequired,
  } = params;

  const baseLabels = {
    [MANAGED_LABEL]: "true",
    [SERVICE_ID_LABEL]: serviceId,
  };

  if (!dnsResolvable) {
    return baseLabels;
  }

  const host = projectSlug ? `${projectSlug}-${slug}` : slug;

  const labels: Record<string, string> = {
    ...baseLabels,
    "traefik.docker.network": config.docker.networkName,

    // Traefik auto-discovers this container via the Docker provider —
    // no control-plane push required. See compose.yaml for how Traefik
    // itself is bootstrapped.
    "traefik.enable": "true",
    [`traefik.http.routers.${slug}.rule`]: `Host(\`${host}.${config.baseDomain}\`)`,
    [`traefik.http.routers.${slug}.entrypoints`]: config.traefik.entrypoint,
    [`traefik.http.routers.${slug}.tls`]: "true",
    [`traefik.http.routers.${slug}.tls.certresolver`]:
      config.traefik.certResolver,
    [`traefik.http.services.${slug}.loadbalancer.server.port`]:
      String(containerPort),
  };

  if (customDomain) {
    const customRouter = `${slug}-custom`;
    labels[`traefik.http.routers.${customRouter}.rule`] =
      `Host(\`${customDomain}\`)`;
    labels[`traefik.http.routers.${customRouter}.entrypoints`] =
      config.traefik.entrypoint;
    labels[`traefik.http.routers.${customRouter}.tls`] = "true";
    labels[`traefik.http.routers.${customRouter}.tls.certresolver`] =
      config.traefik.certResolver;
    // Reuses the primary router's service — same backend, just a second
    // hostname reaching it, not a duplicated loadbalancer config.
    labels[`traefik.http.routers.${customRouter}.service`] = slug;
  }

  if (authRequired) {
    const authMiddleware = `${slug}-auth`;
    labels[`traefik.http.middlewares.${authMiddleware}.forwardauth.address`] =
      config.authCheckUrl;
    labels[`traefik.http.routers.${slug}.middlewares`] = authMiddleware;
    if (customDomain) {
      labels[`traefik.http.routers.${slug}-custom.middlewares`] =
        authMiddleware;
    }
  }

  return labels;
}
