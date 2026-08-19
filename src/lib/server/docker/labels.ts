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
}): Record<string, string> {
  const { serviceId, slug, containerPort } = params;

  return {
    [MANAGED_LABEL]: "true",
    [SERVICE_ID_LABEL]: serviceId,
    "traefik.docker.network": config.docker.networkName,

    // Traefik auto-discovers this container via the Docker provider —
    // no control-plane push required. See compose.yaml for how Traefik
    // itself is bootstrapped.
    "traefik.enable": "true",
    [`traefik.http.routers.${slug}.rule`]: `Host(\`${slug}.${config.baseDomain}\`)`,
    [`traefik.http.routers.${slug}.entrypoints`]: config.traefik.entrypoint,
    [`traefik.http.routers.${slug}.tls`]: "true",
    [`traefik.http.routers.${slug}.tls.certresolver`]:
      config.traefik.certResolver,
    [`traefik.http.services.${slug}.loadbalancer.server.port`]:
      String(containerPort),
  };
}
