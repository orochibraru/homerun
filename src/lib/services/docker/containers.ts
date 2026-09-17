import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { ContainerStatus } from "$lib/types";
import { decryptSecret } from "../secrets.ts";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";
import type {
	ContainerRollout,
	ContainerRolloutInput,
} from "./container-rollout.ts";
import { buildContainerLabels, MANAGED_LABEL } from "./labels.ts";
import { toLogStream } from "./log-stream.ts";
import {
	READINESS_LABEL,
	type ReadinessCheck,
	readinessHealthcheck,
	readinessLabels,
} from "./readiness.ts";
import {
	type ContainerRuntimeParams,
	mergeLabels,
	runtimeArgv,
	runtimeHostConfig,
} from "./runtime-options.ts";

export type { ContainerStatus } from "$lib/types";
export type { RemoteHostConnection } from "./client.ts";

const logger = new Logger("Docker");

function isNotFoundError(error: unknown): boolean {
	return (error as { statusCode?: number } | null)?.statusCode === 404;
}

function containerStateToStatus(state: {
	ExitCode: number;
	Status: string;
}): ContainerStatus {
	if (state.Status === "running") {
		return "running";
	}
	if (state.Status === "created" || state.Status === "restarting") {
		return "starting";
	}
	if (state.Status === "exited" || state.Status === "dead") {
		return state.ExitCode === 0 ? "stopped" : "failed";
	}
	return "stopped";
}

export interface RegistryAuth {
	password: string;
	serveraddress?: string;
	username: string;
}

export interface PullProgressEvent {
	id?: string;
	status: string;
}

export interface PullImageParams {
	image: string;
	tag: string;
	auth?: RegistryAuth;
	onProgress?: (line: string) => void;
	remote?: RemoteHostConnection | null;
}

export interface ContainerSample {
	cpuPercent: number;
	memLimitMb: number;
	memUsedMb: number;
	netRxBytes: number;
	netTxBytes: number;
}

/** The subset of the daemon's stats payload this app reads; dockerode types it as `unknown`. */
interface DockerStats {
	cpu_stats: {
		cpu_usage: { percpu_usage?: number[]; total_usage: number };
		online_cpus?: number;
		system_cpu_usage?: number;
	};
	memory_stats: { limit?: number; usage?: number };
	networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
	precpu_stats: {
		cpu_usage: { total_usage: number };
		system_cpu_usage?: number;
	};
}

export interface VolumeMountParams {
	containerPath: string;
	readOnly: boolean;
	// A bind-mount host path ("/mnt/data/foo") or a Docker-managed named
	// volume name : see StorageVolume in the schema, same field either way.
	source: string;
}

export interface CreateContainerParams {
	containerPort: number;
	cpuLimit?: string | null;
	// Optional second hostname routed to this service (DNS must already
	// point at this host : the app doesn't manage that). No effect when
	// dnsResolvable is false.
	customDomain?: string | null;
	// When false, the container gets no Traefik labels at all : no public
	// <slug>.<baseDomain>, subnet-only reachability. Defaults to true.
	dnsResolvable?: boolean;
	envVars: Record<string, string>;
	image: string;
	memoryLimitMb?: number | null;
	// "bridge" (default) | "host" : shares the host's network namespace
	// directly instead of joining the shared/stack Docker networks, for
	// apps that need it (mDNS/SSDP discovery, e.g. Home Assistant). Docker
	// doesn't allow combining host mode with any other network attachment,
	// so when this is "host": no shared-network alias, no stack-network
	// join, no Traefik labels regardless of dnsResolvable (there's no
	// container-specific IP/network for Traefik's docker provider to route
	// to) : the container is reachable only directly on the host's own
	// network interfaces, on whatever port(s) it binds to itself.
	networkMode?: "bridge" | "host";
	// When set, the container also joins this stack's dedicated network
	// (see docker/networks.ts) : lets sibling services in the same stack
	// reach it, in addition to the shared Traefik network below. No effect
	// when networkMode is "host" (see above).
	stackId?: string | null;
	// "tcp" (default) | "udp" | "both" : which protocol(s) containerPort is
	// declared under (Docker's ExposedPorts). Doesn't publish/map anything by
	// itself either way : see the Networking tab's own "no host port
	// publishing by design" stance; matters for real host-visible reachability
	// only in combination with networkMode: "host" above.
	portProtocol?: "tcp" | "udp" | "both";
	// Prefixes the container name and public subdomain when the service
	// belongs to a stack (e.g. "<stackSlug>-<slug>.<baseDomain>").
	stackSlug?: string | null;
	// When set, this container is created on a remote Docker daemon instead
	// of the local socket : see docker/client.ts's getDocker(). Note: the
	// shared/stack Docker networks and Traefik itself all live on the
	// *local* host, so a remote-hosted service isn't reachable through the
	// normal internal-network or Traefik paths : only directly, if you
	// publish a port yourself. Effectively an isolated remote workload
	// today, not (yet) a fully integrated second node.
	remote?: RemoteHostConnection | null;
	healthcheckCommand?: string | null;
	restartPolicy: string;
	runtime?: ContainerRuntimeParams;
	serviceId: string;
	slug: string;
	tag: string;
	volumes?: VolumeMountParams[];
}

/** What this mixin needs from whatever's ahead of it in the merge chain (see docker.service.ts) : the network and container rollout mixins. */
interface RequiresNetworkMixin {
	abandonContainerRollout: (
		rollout: ContainerRollout,
		containerId: string,
		error: unknown,
	) => Promise<never>;
	beginContainerRollout: (
		input: ContainerRolloutInput,
		onProgress?: (line: string) => void,
	) => Promise<ContainerRollout>;
	completeContainerRollout: (
		rollout: ContainerRollout,
		containerId: string,
		onProgress?: (line: string) => void,
	) => Promise<void>;
	connectToStackNetwork: (
		containerId: string,
		stackId: string,
		alias: string,
	) => Promise<void>;
	ensureSharedNetwork: () => Promise<void>;
}

/**
 * Container lifecycle : pull, create+start (replacing any previous
 * container for the same service), start/stop/restart/remove, status
 * inspection, log streaming. Requires the network mixin ahead of it in
 * the merge chain : createAndStartContainer calls
 * `this.ensureSharedNetwork` and `this.connectToStackNetwork`.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerContainerMixin<
	TBase extends Constructor<BaseDockerService & RequiresNetworkMixin>,
>(Base: TBase) {
	return class DockerContainerService extends Base {
		/**
		 * Container name this app gives its containers. Includes a random
		 * suffix so a redeploy never collides on "name already in use" :
		 * even if the previous container's removal (below) silently failed
		 * to fully complete. The *previous* container for a service is
		 * found by its `homerun.service.id` label, not by name, since names
		 * are no longer stable across deploys.
		 */
		#containerName(slug: string, stackSlug?: string | null): string {
			const suffix = crypto.randomUUID().slice(0, 8);
			const prefix = stackSlug ? `${stackSlug}-` : "";
			return `homerun-${prefix}${slug}-${suffix}`;
		}

		/**
		 * Builds a dockerode authconfig from a service's stored registry
		 * credentials, decrypting the password. Returns undefined for public
		 * images (no registryUsername set).
		 */
		buildAuthConfig(service: {
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

		/**
		 * Looks up the digest of an already-pulled local image, without
		 * pulling it. Returns null when the image exists locally but carries
		 * no digest (never pushed to/pulled from a registry), and undefined
		 * when the image can't be inspected at all (not present locally, or
		 * the Docker call failed).
		 */
		async localImageDigest(
			ref: string,
			remote?: RemoteHostConnection | null,
		): Promise<string | null | undefined> {
			try {
				const inspect = await this.getDocker(remote).getImage(ref).inspect();
				return inspect.RepoDigests?.[0]?.split("@")[1] ?? null;
			} catch {
				return undefined;
			}
		}

		/** Pulls `image:tag`, optionally authenticating against a private registry. */
		async pullImage(
			params: PullImageParams,
		): Promise<{ digest: string | null }> {
			const { image, tag, auth, onProgress, remote } = params;
			const docker = this.getDocker(remote);
			const ref = `${image}:${tag}`;

			logger.info(`Pulling image: ${ref}`);
			onProgress?.(`Pulling ${ref}...`);
			const stream = await docker.pull(ref, auth ? { authconfig: auth } : {});

			// Docker emits one progress event per byte-range update per layer :
			// far too chatty to log a line for each. Only emit a line when a
			// given layer's status actually changes ("Downloading" → "Pull
			// complete" etc).
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
						onProgress?.(
							event.id ? `${event.status}: ${event.id}` : event.status,
						);
					},
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

		/**
		 * Tags a local image under `targetRef` and pushes it, for moving a
		 * just-built image off the daemon it was built on (a build server,
		 * see docker/git-build.ts and deploy.service.ts's cross-host build
		 * path) : the caller pulls `targetRef` back on whichever daemon
		 * actually needs to run it, via `pullImage` above.
		 */
		async pushImage(
			localRef: string,
			targetRef: string,
			auth?: RegistryAuth,
			remote?: RemoteHostConnection | null,
		): Promise<void> {
			const docker = this.getDocker(remote);
			const lastColon = targetRef.lastIndexOf(":");
			const lastSlash = targetRef.lastIndexOf("/");
			const [repo, tag] =
				lastColon === -1 || lastColon < lastSlash
					? [targetRef, "latest"]
					: [targetRef.slice(0, lastColon), targetRef.slice(lastColon + 1)];

			await docker.getImage(localRef).tag({ repo, tag });
			logger.info(`Pushing image: ${repo}:${tag}`);
			const stream = await docker
				.getImage(`${repo}:${tag}`)
				.push({ authconfig: auth, tag });
			await new Promise<void>((resolvePromise, reject) => {
				docker.modem.followProgress(
					stream,
					(err: Error | null) => (err ? reject(err) : resolvePromise()),
					// Per-layer push progress isn't surfaced anywhere : only completion matters here.
					() => undefined,
				);
			});
			logger.info(`Pushed image: ${repo}:${tag}`);
		}

		/**
		 * Host mode shares the host's network namespace directly : Docker
		 * doesn't allow combining it with any other network attachment (see
		 * CreateContainerParams.networkMode), so it wins over everything else.
		 * Otherwise the shared network only exists on the local host, so a
		 * remote daemon gets Docker's own default bridge instead (no Traefik
		 * routing, no internal service-discovery alias).
		 */
		#networkModeFor(params: CreateContainerParams): string | undefined {
			if (params.networkMode === "host") {
				return "host";
			}
			return params.remote ? undefined : config.docker.networkName;
		}

		/**
		 * Builds the dockerode `HostConfig` for a container from its create
		 * params: volume binds, memory/CPU limits, network mode, and restart
		 * policy.
		 */
		#hostConfigFor(params: CreateContainerParams) {
			// Docker's Binds syntax covers both a host bind-mount path and a
			// Docker-managed named volume with the same "source:target[:ro]"
			// form : it tells them apart by whether source looks like a path.
			// Bind-mount sources only make sense for the local host : a remote
			// deploy with volumes attached would try to bind a path on the
			// *remote* machine.
			const binds = (params.volumes ?? []).map(
				(v) => `${v.source}:${v.containerPath}${v.readOnly ? ":ro" : ""}`,
			);

			return {
				...runtimeHostConfig(params.runtime),
				Binds: binds.length > 0 ? binds : undefined,
				Memory: params.memoryLimitMb
					? params.memoryLimitMb * 1024 * 1024
					: undefined,
				NanoCpus: params.cpuLimit
					? Math.round(Number.parseFloat(params.cpuLimit) * 1e9)
					: undefined,
				NetworkMode: this.#networkModeFor(params),
				// "no" is our restart-policy value (matches docker-compose
				// convention for the dropdown); the Docker Engine API itself
				// wants "" for that.
				RestartPolicy: {
					Name: params.restartPolicy === "no" ? "" : params.restartPolicy,
				},
			};
		}

		/**
		 * Builds the full dockerode container-creation options for a service:
		 * env vars, exposed ports, healthcheck, `HostConfig` (via
		 * `#hostConfigFor`), Traefik labels, and the shared-network alias when
		 * applicable.
		 */
		#createContainerOptions(
			params: CreateContainerParams,
			name: string,
			readiness: ReadinessCheck,
		) {
			const isHostNetwork = params.networkMode === "host";
			const protocols =
				params.portProtocol === "both"
					? (["tcp", "udp"] as const)
					: [params.portProtocol ?? "tcp"];

			return {
				...runtimeArgv(params.runtime),
				Env: Object.entries(params.envVars).map(
					([key, value]) => `${key}=${value}`,
				),
				ExposedPorts: Object.fromEntries(
					protocols.map((proto) => [`${params.containerPort}/${proto}`, {}]),
				),
				Healthcheck: readinessHealthcheck(readiness, params.healthcheckCommand),
				HostConfig: this.#hostConfigFor(params),
				Image: `${params.image}:${params.tag}`,
				// Host-mode containers never get Traefik labels regardless of
				// dnsResolvable : there's no container-specific IP/network for
				// Traefik's docker provider to route to in host mode, only the
				// host's own interfaces (see CreateContainerParams.networkMode).
				Labels: mergeLabels(params.runtime?.labels, {
					...buildContainerLabels({
						containerPort: params.containerPort,
						customDomain: params.customDomain,
						dnsResolvable: isHostNetwork ? false : params.dnsResolvable,
						stackSlug: params.stackSlug,
						serviceId: params.serviceId,
						slug: params.slug,
					}),
					...readinessLabels(readiness),
				}),
				// Alias the container as its slug on the shared network, so
				// other services can reach it at a stable hostname even though
				// the container's own name carries a random per-deploy suffix.
				// Only meaningful on the local host in bridge mode : see
				// #networkModeFor.
				NetworkingConfig:
					isHostNetwork || params.remote
						? undefined
						: {
								EndpointsConfig: {
									[config.docker.networkName]: { Aliases: [params.slug] },
								},
							},
				name,
				// Tty combines stdout/stderr into one unframed stream, which
				// keeps the v1 log viewer simple (no demux of Docker's
				// multiplexed stdout/stderr frames needed).
				Tty: true,
			};
		}

		/** Best-effort stack-network join : a failure is degraded connectivity, not a failed deploy. */
		async #joinStackNetwork(
			containerId: string,
			params: CreateContainerParams,
		): Promise<void> {
			if (!params.stackId || params.remote || params.networkMode === "host") {
				return;
			}
			try {
				await this.connectToStackNetwork(
					containerId,
					params.stackId,
					params.slug,
				);
				logger.info(
					`Joined stack network: service=${params.serviceId} stack=${params.stackId}`,
				);
			} catch (err) {
				logger.warn(
					`Could not join stack network: service=${params.serviceId} stack=${params.stackId}`,
					err,
				);
			}
		}

		/** Tells the operator where the new container is actually reachable, which differs per network mode. */
		#reportReachability(
			params: CreateContainerParams,
			onProgress?: (line: string) => void,
		): void {
			if (params.networkMode === "host") {
				logger.info(
					`Container on host network: service=${params.serviceId} port=${params.containerPort}`,
				);
				onProgress?.(
					`Running on the host network : reachable directly on this machine's own port ${params.containerPort}, not through Traefik.`,
				);
				return;
			}
			if (params.remote) {
				onProgress?.(
					"Deployed to remote host : not on the shared network, no Traefik routing (see remote host docs).",
				);
				return;
			}
			logger.info(
				`Reachable internally at ${params.slug}:${params.containerPort} (service=${params.serviceId})`,
			);
			onProgress?.(
				`Reachable at ${params.slug}:${params.containerPort} from other services.`,
			);
		}

		/**
		 * Creates and starts the container for a service, replacing any
		 * previous container for the same service. When the previous one is
		 * running (and neither host networking nor a writable volume rules it
		 * out, see `rolloutStrategy`), the new container starts next to it and
		 * the previous one is only removed once the new one is ready, so
		 * Traefik (which skips a container whose healthcheck hasn't passed,
		 * see `planReadiness` for the check it gets) keeps routing to the old
		 * one meanwhile; otherwise the previous
		 * container is removed first. Ensures the shared Traefik network
		 * exists first (unless the container is remote or on the host
		 * network), attaches under a DNS alias equal to the service's slug so
		 * other services can reach it at `http://<slug>:<containerPort>`
		 * regardless of the container's own (randomized) name, then
		 * best-effort joins the service's stack network. Reports progress and
		 * final reachability via `onProgress`/the logger.
		 *
		 * @throws When the Docker create or start call fails, or
		 *   `RolloutFailedError` when the new container never became ready.
		 */
		async createAndStartContainer(
			params: CreateContainerParams,
			onProgress?: (line: string) => void,
		): Promise<{ containerId: string }> {
			const docker = this.getDocker(params.remote);
			const name = this.#containerName(params.slug, params.stackSlug);

			const rollout = await this.beginContainerRollout(params, onProgress);

			if (!(params.remote || params.networkMode === "host")) {
				await this.ensureSharedNetwork();
			}

			onProgress?.("Creating container...");
			const container = await docker.createContainer(
				this.#createContainerOptions(params, name, rollout.readiness),
			);

			onProgress?.("Starting container...");
			await container
				.start()
				.catch((error) =>
					this.abandonContainerRollout(rollout, container.id, error),
				);
			logger.info(
				`Container created and started: ${name} (${container.id})${
					params.remote ? ` on remote host=${params.remote.id}` : ""
				}`,
			);

			await this.#joinStackNetwork(container.id, params);
			await this.completeContainerRollout(rollout, container.id, onProgress);
			this.#reportReachability(params, onProgress);

			return { containerId: container.id };
		}

		/** Starts a stopped container via the Docker API. */
		async startContainer(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<void> {
			await this.getDocker(remote).getContainer(containerId).start();
			logger.info(`Container started: ${containerId}`);
		}

		/** Stops a running container via the Docker API. */
		async stopContainer(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<void> {
			await this.getDocker(remote).getContainer(containerId).stop();
			logger.info(`Container stopped: ${containerId}`);
		}

		/** Restarts a container via the Docker API. */
		async restartContainer(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<void> {
			await this.getDocker(remote).getContainer(containerId).restart();
			logger.info(`Container restarted: ${containerId}`);
		}

		/** Removes a container via the Docker API, forcing removal (stopping it first) by default. */
		async removeContainer(
			containerId: string,
			opts?: { force?: boolean },
			remote?: RemoteHostConnection | null,
		): Promise<void> {
			await this.getDocker(remote)
				.getContainer(containerId)
				.remove({ force: opts?.force ?? true });
			logger.info(`Container removed: ${containerId}`);
		}

		/** Inspects a container's live Docker state and maps it to our status enum. */
		async inspectStatus(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<ContainerStatus> {
			try {
				const info = await this.getDocker(remote)
					.getContainer(containerId)
					.inspect();
				return containerStateToStatus(info.State);
			} catch (error) {
				return isNotFoundError(error) ? "missing" : "failed";
			}
		}

		/**
		 * A container's combined stdout/stderr as a web ReadableStream: live
		 * and never-ending unless `follow` is false, in which case it's the
		 * last `tail` lines (default 200) and closes.
		 */
		async streamLogs(
			containerId: string,
			opts?: { tail?: number; follow?: boolean },
			remote?: RemoteHostConnection | null,
		): Promise<ReadableStream<Uint8Array>> {
			const container = this.getDocker(remote).getContainer(containerId);
			const base = { stderr: true, stdout: true, tail: opts?.tail ?? 200 };
			return opts?.follow === false
				? toLogStream(await container.logs({ ...base, follow: false }))
				: toLogStream(
						(await container.logs({
							...base,
							follow: true,
						})) as NodeJS.ReadableStream & { destroy: () => void },
					);
		}

		/**
		 * One non-streaming `docker stats` sample for a container, in the
		 * units the graphs store (see schema.ts's stat_sample): CPU as a
		 * percentage of one host's worth of cores, memory in MB, and the
		 * network counters as the daemon reports them (cumulative since the
		 * container started, so rates are derived at read time).
		 *
		 * Returns null rather than throwing for anything that isn't running,
		 * which is the normal case for most of the list this is called over.
		 */
		async sampleContainerStats(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<ContainerSample | null> {
			try {
				const stats = (await this.getDocker(remote)
					.getContainer(containerId)
					.stats({ stream: false })) as DockerStats;

				const cpuDelta =
					stats.cpu_stats.cpu_usage.total_usage -
					stats.precpu_stats.cpu_usage.total_usage;
				const systemDelta =
					(stats.cpu_stats.system_cpu_usage ?? 0) -
					(stats.precpu_stats.system_cpu_usage ?? 0);
				const cores =
					stats.cpu_stats.online_cpus ??
					stats.cpu_stats.cpu_usage.percpu_usage?.length ??
					1;
				const cpuPercent =
					systemDelta > 0 && cpuDelta > 0
						? (cpuDelta / systemDelta) * cores * 100
						: 0;

				const networks = Object.values(stats.networks ?? {});
				return {
					cpuPercent: Math.max(0, cpuPercent),
					memLimitMb: (stats.memory_stats.limit ?? 0) / 1024 / 1024,
					memUsedMb: (stats.memory_stats.usage ?? 0) / 1024 / 1024,
					netRxBytes: networks.reduce(
						(sum, net) => sum + (net.rx_bytes ?? 0),
						0,
					),
					netTxBytes: networks.reduce(
						(sum, net) => sum + (net.tx_bytes ?? 0),
						0,
					),
				};
			} catch {
				return null;
			}
		}

		/**
		 * The container's Docker healthcheck status and the last probe's
		 * output, or null when the container has no healthcheck configured,
		 * only has Homerun's generated readiness check, or can't be inspected.
		 */
		async containerHealth(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<{ output: string | null; status: string } | null> {
			try {
				const info = await this.getDocker(remote)
					.getContainer(containerId)
					.inspect();
				const health = info.State?.Health;
				if (!health?.Status || info.Config?.Labels?.[READINESS_LABEL]) {
					return null;
				}
				return {
					output: health.Log?.at(-1)?.Output?.trim() || null,
					status: health.Status,
				};
			} catch {
				return null;
			}
		}

		/** The container's own IP on the first network it's attached to, for the internal liveness probe. */
		async containerAddress(
			containerId: string,
			remote?: RemoteHostConnection | null,
		): Promise<string | null> {
			try {
				const info = await this.getDocker(remote)
					.getContainer(containerId)
					.inspect();
				const networks = Object.values(info.NetworkSettings?.Networks ?? {});
				return networks.find((net) => net.IPAddress)?.IPAddress ?? null;
			} catch {
				return null;
			}
		}

		/**
		 * Lists only containers this app created (filtered on MANAGED_LABEL).
		 * This app must never enumerate, inspect side effects on, or remove
		 * containers on the host that it didn't create.
		 */
		listManagedContainers() {
			return this.getDocker().listContainers({
				all: true,
				filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }),
			});
		}
	};
}
