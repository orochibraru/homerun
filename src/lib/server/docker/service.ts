import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { ContainerStatus } from "$lib/types";
import { getDocker } from "./client.ts";
import {
  buildContainerLabels,
  MANAGED_LABEL,
  SERVICE_ID_LABEL,
} from "./labels.ts";
import { connectToProjectNetwork } from "./networks.ts";
import { decryptSecret } from "./secrets.ts";

export type { ContainerStatus } from "$lib/types";

const logger = new Logger("Docker");

export interface RegistryAuth {
  password: string;
  serveraddress?: string;
  username: string;
}

/**
 * Container name this app gives its containers. Includes a random suffix
 * so a redeploy never collides on "name already in use" — even if the
 * previous container's removal (below) silently failed to fully complete.
 * The *previous* container for a service is found by its
 * `localrun.service.id` label, not by name, since names are no longer
 * stable across deploys.
 */
function containerName(slug: string, projectSlug?: string | null): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const prefix = projectSlug ? `${projectSlug}-` : "";
  return `localrun-${prefix}${slug}-${suffix}`;
}

/** The currently-running (or last) container for a service, if any — found by label, not name. */
async function findServiceContainer(serviceId: string) {
  const docker = getDocker();
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${SERVICE_ID_LABEL}=${serviceId}`] }),
  });
  return containers[0] ?? null;
}

/**
 * Builds a dockerode authconfig from a service's stored registry
 * credentials, decrypting the password. Returns undefined for public
 * images (no registryUsername set).
 */
export function buildAuthConfig(service: {
  registryUrl: string | null;
  registryUsername: string | null;
  registryPasswordEnc: string | null;
}): RegistryAuth | undefined {
  if (!service.registryUsername) {
    return;
  }

  const password = service.registryPasswordEnc
    ? decryptSecret(service.registryPasswordEnc)
    : null;

  return {
    password: password ?? "",
    serveraddress: service.registryUrl ?? undefined,
    username: service.registryUsername,
  };
}

export interface PullProgressEvent {
  id?: string;
  status: string;
}

/** Pulls `image:tag`, optionally authenticating against a private registry. */
export async function pullImage(
  image: string,
  tag: string,
  auth?: RegistryAuth,
  onProgress?: (line: string) => void
): Promise<{ digest: string | null }> {
  const docker = getDocker();
  const ref = `${image}:${tag}`;

  logger.info(`Pulling image: ${ref}`);
  onProgress?.(`Pulling ${ref}...`);
  const stream = await docker.pull(ref, auth ? { authconfig: auth } : {});

  // Docker emits one progress event per byte-range update per layer —
  // far too chatty to log a line for each. Only emit a line when a given
  // layer's status actually changes ("Downloading" → "Pull complete" etc).
  const lastStatusById = new Map<string, string>();
  await new Promise<void>((resolvePromise, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => (err ? reject(err) : resolvePromise()),
      (event: PullProgressEvent) => {
        const key = event.id ?? "";
        if (lastStatusById.get(key) === event.status) {
          return;
        }
        lastStatusById.set(key, event.status);
        onProgress?.(event.id ? `${event.status}: ${event.id}` : event.status);
      }
    );
  });

  try {
    const inspect = await docker.getImage(ref).inspect();
    const digest = inspect.RepoDigests?.[0]?.split("@")[1] ?? null;
    logger.info(`Pulled image: ${ref} digest=${digest ?? "unknown"}`);
    return { digest };
  } catch (err) {
    logger.warn(`Pulled image but inspect failed: ${ref}`, err);
    return { digest: null };
  }
}

export interface VolumeMountParams {
  containerPath: string;
  readOnly: boolean;
  // A bind-mount host path ("/mnt/data/foo") or a Docker-managed named
  // volume name — see StorageVolume in the schema, same field either way.
  source: string;
}

export interface CreateContainerParams {
  // When true, gatekeeps this service behind this app's own login via a
  // Traefik forwardAuth middleware. No effect when dnsResolvable is false.
  authRequired?: boolean;
  containerPort: number;
  cpuLimit?: string | null;
  // Optional second hostname routed to this service (DNS must already
  // point at this host — the app doesn't manage that). No effect when
  // dnsResolvable is false.
  customDomain?: string | null;
  // When false, the container gets no Traefik labels at all — no public
  // <slug>.<baseDomain>, subnet-only reachability. Defaults to true.
  dnsResolvable?: boolean;
  envVars: Record<string, string>;
  image: string;
  memoryLimitMb?: number | null;
  // When set, the container also joins this project's dedicated network
  // (see docker/networks.ts) — lets sibling services in the same project
  // reach it, in addition to the shared Traefik network below.
  projectId?: string | null;
  // Prefixes the container name and public subdomain when the service
  // belongs to a project (e.g. "<projectSlug>-<slug>.<baseDomain>").
  projectSlug?: string | null;
  restartPolicy: string;
  serviceId: string;
  slug: string;
  tag: string;
  volumes?: VolumeMountParams[];
}

/**
 * Creates and starts the container for a service, replacing any
 * previous container for the same service (a redeploy — see
 * findServiceContainer above). Attaches to the shared Traefik network
 * under a DNS alias equal to the service's slug — no host port
 * publishing needed, Traefik reaches it over that network, and other
 * services can reach it at `http://<slug>:<containerPort>` regardless of
 * the container's own (randomized) name.
 */
export async function createAndStartContainer(
  params: CreateContainerParams,
  onProgress?: (line: string) => void
): Promise<{ containerId: string }> {
  const docker = getDocker();
  const name = containerName(params.slug, params.projectSlug);

  // Replace any previous container for this service (redeploy), found by
  // its service-id label rather than by name (see containerName above).
  const existingInfo = await findServiceContainer(params.serviceId);
  if (existingInfo) {
    onProgress?.("Replacing previous container...");
    try {
      const existing = docker.getContainer(existingInfo.Id);
      if (existingInfo.State === "running") {
        await existing.stop();
      }
      await existing.remove({ force: true });
    } catch {
      // Already gone / couldn't be removed cleanly — proceed anyway, the
      // random name suffix means the new container won't collide with it.
    }
  }

  onProgress?.("Creating container...");

  // "no" is our restart-policy value (matches docker-compose convention
  // for the dropdown); the Docker Engine API itself wants "" for that.
  const restartPolicyName =
    params.restartPolicy === "no" ? "" : params.restartPolicy;

  // Docker's Binds syntax covers both a host bind-mount path and a
  // Docker-managed named volume with the same "source:target[:ro]" form —
  // it tells them apart by whether source looks like a path.
  const binds = (params.volumes ?? []).map(
    (v) => `${v.source}:${v.containerPath}${v.readOnly ? ":ro" : ""}`
  );

  const container = await docker.createContainer({
    Env: Object.entries(params.envVars).map(
      ([key, value]) => `${key}=${value}`
    ),
    ExposedPorts: { [`${params.containerPort}/tcp`]: {} },
    HostConfig: {
      Binds: binds.length > 0 ? binds : undefined,
      Memory: params.memoryLimitMb
        ? params.memoryLimitMb * 1024 * 1024
        : undefined,
      NanoCpus: params.cpuLimit
        ? Math.round(Number.parseFloat(params.cpuLimit) * 1e9)
        : undefined,
      NetworkMode: config.docker.networkName,
      RestartPolicy: { Name: restartPolicyName },
    },
    Image: `${params.image}:${params.tag}`,
    Labels: buildContainerLabels({
      authRequired: params.authRequired,
      containerPort: params.containerPort,
      customDomain: params.customDomain,
      dnsResolvable: params.dnsResolvable,
      projectSlug: params.projectSlug,
      serviceId: params.serviceId,
      slug: params.slug,
    }),
    // Alias the container as its slug on the shared network, so other
    // services can reach it at a stable hostname even though the
    // container's own name carries a random per-deploy suffix.
    NetworkingConfig: {
      EndpointsConfig: {
        [config.docker.networkName]: { Aliases: [params.slug] },
      },
    },
    name,
    // Tty combines stdout/stderr into one unframed stream, which keeps
    // the v1 log viewer simple (no demux of Docker's multiplexed
    // stdout/stderr frames needed).
    Tty: true,
  });

  onProgress?.("Starting container...");
  await container.start();
  logger.info(`Container created and started: ${name} (${container.id})`);

  if (params.projectId) {
    try {
      await connectToProjectNetwork(
        container.id,
        params.projectId,
        params.slug
      );
      logger.info(
        `Joined project network: service=${params.serviceId} project=${params.projectId}`
      );
    } catch (err) {
      // The container is already up on the shared network and reachable
      // via Traefik — a failed project-network join shouldn't fail the
      // whole deploy, just log it as degraded connectivity.
      logger.warn(
        `Could not join project network: service=${params.serviceId} project=${params.projectId}`,
        err
      );
    }
  }

  logger.info(
    `Reachable internally at ${params.slug}:${params.containerPort} (service=${params.serviceId})`
  );
  onProgress?.(
    `Reachable at ${params.slug}:${params.containerPort} from other services.`
  );

  return { containerId: container.id };
}

export async function startContainer(containerId: string): Promise<void> {
  await getDocker().getContainer(containerId).start();
  logger.info(`Container started: ${containerId}`);
}

export async function stopContainer(containerId: string): Promise<void> {
  await getDocker().getContainer(containerId).stop();
  logger.info(`Container stopped: ${containerId}`);
}

export async function restartContainer(containerId: string): Promise<void> {
  await getDocker().getContainer(containerId).restart();
  logger.info(`Container restarted: ${containerId}`);
}

export async function removeContainer(
  containerId: string,
  opts?: { force?: boolean }
): Promise<void> {
  await getDocker()
    .getContainer(containerId)
    .remove({ force: opts?.force ?? true });
  logger.info(`Container removed: ${containerId}`);
}

/** Inspects a container's live Docker state and maps it to our status enum. */
export async function inspectStatus(
  containerId: string
): Promise<ContainerStatus> {
  try {
    const info = await getDocker().getContainer(containerId).inspect();
    const status = info.State.Status;

    if (status === "running") {
      return "running";
    }
    if (status === "created" || status === "restarting") {
      return "starting";
    }
    if (status === "exited" || status === "dead") {
      return info.State.ExitCode === 0 ? "stopped" : "failed";
    }
    return "stopped";
  } catch {
    // Container doesn't exist (e.g. removed out-of-band) — treat as failed
    // so it's visibly wrong in the UI rather than silently stale.
    return "failed";
  }
}

/** Streams a container's combined stdout/stderr as a web ReadableStream. */
export async function streamLogs(
  containerId: string,
  opts?: { tail?: number; follow?: boolean }
): Promise<ReadableStream<Uint8Array>> {
  const container = getDocker().getContainer(containerId);
  const nodeStream = await container.logs({
    follow: opts?.follow ?? true,
    stderr: true,
    stdout: true,
    tail: opts?.tail ?? 200,
  });

  return new ReadableStream<Uint8Array>({
    cancel() {
      nodeStream.destroy();
    },
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err: Error) => controller.error(err));
    },
  });
}

/**
 * Lists only containers this app created (filtered on MANAGED_LABEL).
 * This app must never enumerate, inspect side effects on, or remove
 * containers on the host that it didn't create.
 */
export function listManagedContainers() {
  return getDocker().listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }),
  });
}
