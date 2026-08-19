import { config } from "$lib/config";
import type { ContainerStatus } from "$lib/types";
import { getDocker } from "./client.ts";
import { buildContainerLabels, MANAGED_LABEL } from "./labels.ts";
import { decryptSecret } from "./secrets.ts";

export type { ContainerStatus };

export interface RegistryAuth {
  password: string;
  serveraddress?: string;
  username: string;
}

/** Container name this app gives its containers — also used to find/replace on redeploy. */
function containerName(slug: string): string {
  return `localrun-${slug}`;
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

/** Pulls `image:tag`, optionally authenticating against a private registry. */
export async function pullImage(
  image: string,
  tag: string,
  auth?: RegistryAuth
): Promise<{ digest: string | null }> {
  const docker = getDocker();
  const ref = `${image}:${tag}`;

  const stream = await docker.pull(ref, auth ? { authconfig: auth } : {});
  await new Promise<void>((resolvePromise, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) =>
      err ? reject(err) : resolvePromise()
    );
  });

  try {
    const inspect = await docker.getImage(ref).inspect();
    const digest = inspect.RepoDigests?.[0]?.split("@")[1] ?? null;
    return { digest };
  } catch {
    return { digest: null };
  }
}

export interface CreateContainerParams {
  containerPort: number;
  cpuLimit?: string | null;
  envVars: Record<string, string>;
  image: string;
  memoryLimitMb?: number | null;
  restartPolicy: string;
  serviceId: string;
  slug: string;
  tag: string;
}

/**
 * Creates and starts the container for a service, replacing any
 * previous container with the same name (a redeploy). Attaches
 * directly to the shared Traefik network by name — no host port
 * publishing needed, Traefik reaches it over that network.
 */
export async function createAndStartContainer(
  params: CreateContainerParams
): Promise<{ containerId: string }> {
  const docker = getDocker();
  const name = containerName(params.slug);

  // Replace any previous container for this service (redeploy).
  try {
    const existing = docker.getContainer(name);
    const info = await existing.inspect();
    if (info.State.Running) {
      await existing.stop();
    }
    await existing.remove({ force: true });
  } catch {
    // No previous container — nothing to clean up.
  }

  // "no" is our restart-policy value (matches docker-compose convention
  // for the dropdown); the Docker Engine API itself wants "" for that.
  const restartPolicyName =
    params.restartPolicy === "no" ? "" : params.restartPolicy;

  const container = await docker.createContainer({
    Env: Object.entries(params.envVars).map(
      ([key, value]) => `${key}=${value}`
    ),
    ExposedPorts: { [`${params.containerPort}/tcp`]: {} },
    HostConfig: {
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
      containerPort: params.containerPort,
      serviceId: params.serviceId,
      slug: params.slug,
    }),
    name,
    // Tty combines stdout/stderr into one unframed stream, which keeps
    // the v1 log viewer simple (no demux of Docker's multiplexed
    // stdout/stderr frames needed).
    Tty: true,
  });

  await container.start();
  return { containerId: container.id };
}

export async function startContainer(containerId: string): Promise<void> {
  await getDocker().getContainer(containerId).start();
}

export async function stopContainer(containerId: string): Promise<void> {
  await getDocker().getContainer(containerId).stop();
}

export async function restartContainer(containerId: string): Promise<void> {
  await getDocker().getContainer(containerId).restart();
}

export async function removeContainer(
  containerId: string,
  opts?: { force?: boolean }
): Promise<void> {
  await getDocker()
    .getContainer(containerId)
    .remove({ force: opts?.force ?? true });
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
export async function listManagedContainers() {
  return getDocker().listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }),
  });
}
