import { config } from "$lib/config";

/**
 * Every container this app creates is tagged with these two labels.
 * `listManagedContainers()` (see service.ts) always filters on
 * MANAGED_LABEL — this app must never list, inspect, or touch a
 * container on the host that it didn't create itself.
 */
export const MANAGED_LABEL = "localrun.managed";
export const SERVICE_ID_LABEL = "localrun.service.id";

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
}): Record<string, string> {
  const {
    serviceId,
    slug,
    containerPort,
    dnsResolvable = true,
    projectSlug,
  } = params;

  const baseLabels = {
    [MANAGED_LABEL]: "true",
    [SERVICE_ID_LABEL]: serviceId,
  };

  if (!dnsResolvable) {
    return baseLabels;
  }

  const host = projectSlug ? `${projectSlug}-${slug}` : slug;

  return {
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
}
