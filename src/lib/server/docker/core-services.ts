import { getDocker } from "./client.ts";

const LEADING_SLASH_RE = /^\//;

/**
 * Locates the Traefik container this app's `compose.yaml` bootstraps.
 *
 * This is a DELIBERATE, narrow exception to the "only touch containers
 * this app created" rule (see labels.ts) — Traefik is core infrastructure
 * this app depends on but doesn't manage the lifecycle of. Scope stays
 * strictly read-only (logs only, never start/stop/remove) and matched by
 * image name, since compose project naming isn't guaranteed stable across
 * setups (no-compose / standalone Traefik is a documented fallback too).
 */
export async function findTraefikContainer(): Promise<{
  id: string;
  name: string;
} | null> {
  const containers = await getDocker().listContainers({ all: true });
  const match = containers.find((c) => c.Image.startsWith("traefik"));
  if (!match) {
    return null;
  }
  return {
    id: match.Id,
    name:
      match.Names[0]?.replace(LEADING_SLASH_RE, "") ?? match.Id.slice(0, 12),
  };
}
