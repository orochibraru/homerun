import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { ContainerStatus } from "$lib/types";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { ReadinessPlanInput } from "./container-rollout.ts";
import type {
	PullImageParams,
	RegistryAuth,
	VolumeMountParams,
} from "./containers.ts";
import { buildContainerLabels, SERVICE_ID_LABEL } from "./labels.ts";
import {
	type ReadinessCheck,
	readinessHealthcheck,
	readinessLabels,
} from "./readiness.ts";
import {
	type ContainerRuntimeParams,
	capabilityName,
	mergeLabels,
} from "./runtime-options.ts";
import type { SwarmServiceSpec } from "./swarm-rollout.ts";

const logger = new Logger("Swarm");

export const SWARM_REFRESH_SECONDS = 2;

/**
 * Swarm services can only join an **overlay** network, and the shared
 * network standalone containers use (`config.docker.networkName`) already
 * exists as a bridge on any instance that ever deployed anything, with
 * Traefik and the app itself attached to it. A live bridge network can't be
 * converted, so swarm mode gets its own attachable overlay alongside it
 * rather than fighting over one name : Traefik joins both and routes either
 * way.
 */
export function swarmNetworkName(): string {
	return `${config.docker.networkName}-swarm`;
}

/**
 * Whether `docker info`'s security options mark the daemon as rootless.
 * Swarm mode can't work there: a rootless daemon can't create the overlay
 * network a swarm service joins, and fails the attach with a bare "context
 * deadline exceeded" after the swarm was already initialised.
 */
export function isRootlessDaemon(
	securityOptions: string[] | undefined,
): boolean {
	return (securityOptions ?? []).some((option) =>
		option.split(",").includes("name=rootless"),
	);
}

/**
 * Why swarm mode can't run on the daemon `docker info` describes, or null
 * when it can. A rootless daemon can't create the overlay network a swarm
 * service joins.
 */
export function swarmUnavailableReason(
	securityOptions: string[] | undefined,
): string | null {
	if (!isRootlessDaemon(securityOptions)) {
		return null;
	}
	return "This Docker daemon runs rootless, and rootless Docker can't create the overlay networks swarm services need. Move Homerun onto the system (rootful) daemon first: sudo homerun-installer --migrate-to-rootful.";
}

/**
 * The orchestration mode a brand new instance starts in: swarm when this
 * daemon is already a swarm manager and isn't rootless (what the default
 * installer sets up), standalone otherwise.
 */
export function initialOrchestrationMode(info: {
	SecurityOptions?: string[];
	Swarm?: { ControlAvailable?: boolean; LocalNodeState?: string };
}): "standalone" | "swarm" {
	const manager =
		info.Swarm?.LocalNodeState === "active" &&
		info.Swarm.ControlAvailable === true;
	return manager && swarmUnavailableReason(info.SecurityOptions) === null
		? "swarm"
		: "standalone";
}

/**
 * A service volume as a swarm mount: an absolute source is a bind mount of
 * that host path, anything else is a named volume, the same rule Docker's
 * `Binds` syntax applies to a standalone container.
 */
export function swarmMount(volume: VolumeMountParams): {
	ReadOnly: boolean;
	Source: string;
	Target: string;
	Type: "bind" | "volume";
} {
	return {
		ReadOnly: volume.readOnly,
		Source: volume.source,
		Target: volume.containerPath,
		Type: volume.source.startsWith("/") ? "bind" : "volume",
	};
}

/**
 * The networks a swarm service's tasks attach to: the host's own network
 * stack for host networking, otherwise the shared overlay with the slug as
 * an alias, so other services reach it at `http://<slug>:<port>` the same
 * way they reach a standalone container.
 */
export function swarmNetworksFor(
	networkMode: "bridge" | "host" | undefined,
	overlay: string,
	slug: string,
): { Aliases?: string[]; Target: string }[] {
	if (networkMode === "host") {
		return [{ Target: "host" }];
	}
	return [{ Aliases: [slug], Target: overlay }];
}

/** Swarm's restart conditions for this app's restart policy values: "no" never restarts, "on-failure" only after a non-zero exit, anything else always. */
export function swarmRestartCondition(
	restartPolicy: string,
): "any" | "none" | "on-failure" {
	if (restartPolicy === "no") {
		return "none";
	}
	return restartPolicy === "on-failure" ? "on-failure" : "any";
}

/** What this mixin needs from whatever's ahead of it in the merge chain (see docker.service.ts) : the container mixin's pullImage and the swarm rollout mixin. */
interface RequiresContainerMixin {
	planReadiness: (
		input: ReadinessPlanInput,
		onProgress?: (line: string) => void,
	) => Promise<ReadinessCheck>;
	rollOutSwarmService: (
		swarmServiceId: string,
		spec: SwarmServiceSpec,
		onProgress?: (line: string) => void,
	) => Promise<{ swarmServiceId: string }>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
}

export interface SwarmReadiness {
	network: string;
	overlayReady: boolean;
	swarmActive: boolean;
	traefikFound: boolean;
	traefikSwarmProvider: boolean;
}

export interface CreateSwarmServiceParams {
	auth?: RegistryAuth;
	containerPort: number;
	cpuLimit?: string | null;
	customDomain?: string | null;
	dnsResolvable?: boolean;
	envVars: Record<string, string>;
	image: string;
	memoryLimitMb?: number | null;
	networkMode?: "bridge" | "host";
	portProtocol?: "tcp" | "udp" | "both";
	healthcheckCommand?: string | null;
	runtime?: ContainerRuntimeParams;
	stackSlug?: string | null;
	replicas: number;
	restartPolicy: string;
	serviceId: string;
	slug: string;
	tag: string;
	volumes?: VolumeMountParams[];
}

/**
 * Docker Swarm equivalent of docker/containers.ts, for services deployed
 * under `instanceSettings.orchestrationMode === "swarm"` : a dockerode
 *Service* (replicated, self-healing, scalable) instead of a single
 * container. Deliberately local-only for v1 : this app's Remote Hosts
 * feature (an arbitrary separate Docker daemon) doesn't apply the same way
 * under swarm, a "remote" node has to actually join *this* swarm as a
 * worker and get targeted via placement constraints, not connected to as
 * an independent client. Not built here, flagged as a real gap : swarm-mode
 * services always run against the local swarm manager.
 *
 * The host is prepared by `enableSwarmMode` (core-services.ts) when the
 * orchestration mode is switched on the dashboard : `docker swarm init`
 * through `initSwarm` below, the overlay network, and Traefik's
 * `--providers.swarm` flags on the live container.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerSwarmMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
>(Base: TBase) {
	return class DockerSwarmService extends Base {
		/** Whether this daemon is already a swarm manager. */
		async isSwarmActive(): Promise<boolean> {
			const info = await this.getDocker().info();
			return info?.Swarm?.LocalNodeState === "active";
		}

		/**
		 * Refuses to go further on a rootless daemon, before anything on the
		 * host has been changed.
		 *
		 * @throws When this daemon runs rootless.
		 */
		async assertSwarmCapableDaemon(): Promise<void> {
			const info = await this.getDocker().info();
			const reason = swarmUnavailableReason(info?.SecurityOptions);
			if (reason) {
				throw new Error(reason);
			}
		}

		/**
		 * Why swarm mode can't be switched on for this daemon, for the settings
		 * page to show before anyone submits. Null when it can, and also when
		 * the daemon can't be reached, since that isn't a reason to refuse.
		 */
		async swarmModeUnavailableReason(): Promise<string | null> {
			const info = await this.getDocker()
				.info()
				.catch(() => null);
			return info ? swarmUnavailableReason(info.SecurityOptions) : null;
		}

		/**
		 * The mode a fresh instance should start in, from the live daemon (see
		 * `initialOrchestrationMode`). Standalone when the daemon can't be
		 * reached.
		 */
		async detectInitialOrchestrationMode(): Promise<"standalone" | "swarm"> {
			const info = await this.getDocker()
				.info()
				.catch(() => null);
			return info ? initialOrchestrationMode(info) : "standalone";
		}

		/**
		 * `docker swarm init` on this host, idempotent : returns false when
		 * the daemon was already a manager. The one place this app runs a
		 * host-level daemon operation, and it does so only because the
		 * dashboard's own Swarm switch is otherwise a setting that changes
		 * nothing.
		 */
		async initSwarm(): Promise<boolean> {
			if (await this.isSwarmActive()) {
				return false;
			}
			await this.getDocker().swarmInit({ ListenAddr: "0.0.0.0:2377" });
			logger.info("Swarm initialised on this host");
			return true;
		}

		/**
		 * What swarm mode needs before a service can be deployed under it,
		 * each checked against the live daemon rather than assumed : the
		 * daemon being a swarm manager, the overlay network existing, and
		 * Traefik actually running its swarm provider. Read-only.
		 */
		async swarmReadiness(): Promise<SwarmReadiness> {
			const network = swarmNetworkName();
			const docker = this.getDocker();
			const [active, networks] = await Promise.all([
				this.isSwarmActive().catch(() => false),
				docker.listNetworks().catch(() => []),
			]);
			const traefik = await this.getDocker()
				.listContainers({ all: true })
				.then((rows) => rows.find((row) => row.Image.startsWith("traefik")))
				.catch(() => undefined);
			const cmd = traefik
				? await docker
						.getContainer(traefik.Id)
						.inspect()
						.then((info) => info.Config.Cmd ?? [])
						.catch(() => [])
				: [];
			return {
				network,
				overlayReady: networks.some((net) => net.Name === network),
				swarmActive: active,
				traefikFound: !!traefik,
				traefikSwarmProvider: cmd.some(
					(arg) =>
						arg.startsWith("--providers.swarm=true") ||
						arg.startsWith("--providers.docker.swarmMode=true"),
				),
			};
		}

		/** Idempotent : swarm networks are cluster-wide, created once and reused by every swarm-mode service. */
		async ensureSwarmNetwork(name: string): Promise<void> {
			const docker = this.getDocker();
			try {
				await docker.createNetwork({
					Attachable: true,
					Driver: "overlay",
					Name: name,
				});
				logger.info(`Swarm overlay network created: ${name}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (!message.includes("already exists")) {
					throw err;
				}
			}
		}

		/**
		 * Best-effort pre-pull : same "warn, don't block" posture as a bad
		 * image ref elsewhere, createService still surfaces a real error if
		 * the daemon genuinely can't pull the image itself.
		 */
		async #prePullImage(
			params: CreateSwarmServiceParams,
			onProgress?: (line: string) => void,
		): Promise<void> {
			try {
				await this.pullImage({
					auth: params.auth,
					image: params.image,
					onProgress,
					tag: params.tag,
				});
			} catch (err) {
				logger.warn(
					`Pull before service create failed for ${params.image}:${params.tag}`,
					err,
				);
			}
		}

		/** Builds the dockerode `TaskTemplate` for a swarm service from its create params: env, healthcheck, image, labels, bind and named-volume mounts, its networks (`swarmNetworksFor`), resource limits, and restart condition. */
		#taskTemplateFor(
			params: CreateSwarmServiceParams,
			readiness: ReadinessCheck,
		) {
			return {
				ContainerSpec: {
					Args: params.runtime?.command ?? undefined,
					CapabilityAdd: params.runtime?.capAdd.length
						? params.runtime.capAdd.map(capabilityName)
						: undefined,
					Command: params.runtime?.entrypoint ?? undefined,
					Env: Object.entries(params.envVars).map(([k, v]) => `${k}=${v}`),
					Healthcheck: readinessHealthcheck(
						readiness,
						params.healthcheckCommand,
					),
					Image: `${params.image}:${params.tag}`,
					Labels: mergeLabels(params.runtime?.labels, {
						[SERVICE_ID_LABEL]: params.serviceId,
						"homerun.managed": "true",
						...readinessLabels(readiness),
					}),
					Mounts: (params.volumes ?? []).map(swarmMount),
				},
				Networks: swarmNetworksFor(
					params.networkMode,
					swarmNetworkName(),
					params.slug,
				),
				Resources: {
					Limits: {
						MemoryBytes: params.memoryLimitMb
							? params.memoryLimitMb * 1024 * 1024
							: undefined,
						NanoCPUs: params.cpuLimit
							? Math.round(Number.parseFloat(params.cpuLimit) * 1e9)
							: undefined,
					},
				},
				RestartPolicy: {
					Condition: swarmRestartCondition(params.restartPolicy),
				},
			};
		}

		/**
		 * Pulls the image, then creates or updates the swarm service backing
		 * one Homerun service: ensures the shared overlay network, best-effort
		 * pre-pulls the image (`#prePullImage`), then either rolls the existing
		 * swarm service for this service id (found by label, see
		 * `#findSwarmService`) onto the new spec in place, health-gated
		 * (`rollOutSwarmService`, with the readiness check `planReadiness`
		 * picks), or creates it. Reports progress via
		 * `onProgress`.
		 *
		 * @throws When the Docker create-service call fails, or
		 *   `RolloutFailedError` when swarm rolled the update back.
		 */
		async createAndStartSwarmService(
			params: CreateSwarmServiceParams,
			onProgress?: (line: string) => void,
		): Promise<{ swarmServiceId: string }> {
			const docker = this.getDocker();
			await this.ensureSwarmNetwork(swarmNetworkName());

			const existing = await this.#findSwarmService(params.serviceId);
			await this.#prePullImage(params, onProgress);

			if (params.runtime?.privileged || params.runtime?.devices.length) {
				onProgress?.(
					"Swarm services can't run privileged or map devices : those settings are ignored under swarm mode.",
				);
			}
			for (const line of await this.#multiNodeWarnings(params)) {
				onProgress?.(line);
			}
			const readiness = await this.planReadiness(
				{
					...params,
					image: `${params.image}:${params.tag}`,
					workload: "task",
				},
				onProgress,
			);
			const spec = {
				Labels: mergeLabels(
					params.runtime?.labels,
					buildContainerLabels({
						containerPort: params.containerPort,
						customDomain: params.customDomain,
						dnsResolvable:
							params.networkMode === "host" ? false : params.dnsResolvable,
						networkName: swarmNetworkName(),
						stackSlug: params.stackSlug,
						serviceId: params.serviceId,
						slug: params.slug,
					}),
				),
				Mode: { Replicated: { Replicas: params.replicas } },
				Name: this.#swarmServiceName(params.slug, params.stackSlug),
				TaskTemplate: this.#taskTemplateFor(params, readiness),
			};
			if (existing) {
				return await this.rollOutSwarmService(existing.ID, spec, onProgress);
			}
			onProgress?.("Creating swarm service...");
			// Swarm has no per-service EXPOSE equivalent to declare protocols
			// the way standalone containers do, and no port is published
			// either way (matching the rest of this app's "no host port
			// publishing by design" stance), so params.portProtocol isn't
			// attached to anything dockerode's swarm API accepts here.
			const created = await docker.createService(spec);

			logger.info(
				`Swarm service created: id=${created.id ?? created.ID} service=${params.serviceId}`,
			);
			return { swarmServiceId: created.id ?? created.ID };
		}

		/**
		 * What stops working once the swarm has more than one node: an image
		 * built on this host has no registry for another node to pull it from,
		 * and a named volume or bind path only exists on the node a replica
		 * lands on. Empty on a single-node swarm, or when the nodes can't be
		 * listed.
		 */
		async #multiNodeWarnings(
			params: CreateSwarmServiceParams,
		): Promise<string[]> {
			const nodes = await this.getDocker()
				.listNodes()
				.catch(() => []);
			if (nodes.length < 2) {
				return [];
			}
			const warnings: string[] = [];
			if (params.image.startsWith("homerun-build-")) {
				warnings.push(
					"This image was built on this host and never pushed to a registry : replicas placed on another swarm node can't pull it. Set a build cache registry on the Source tab.",
				);
			}
			if ((params.volumes ?? []).length > 0) {
				warnings.push(
					"Volumes are local to each swarm node : a replica placed on another node gets its own empty copy.",
				);
			}
			return warnings;
		}

		/** Removes a swarm service via the Docker API. */
		async removeSwarmService(swarmServiceId: string): Promise<void> {
			await this.getDocker().getService(swarmServiceId).remove();
		}

		/** "Stop"/"start" in swarm terms : scale replicas to 0, or back up to the service's configured count. */
		async scaleSwarmService(
			swarmServiceId: string,
			replicas: number,
		): Promise<void> {
			const service = this.getDocker().getService(swarmServiceId);
			const inspected = await service.inspect();
			await service.update({
				...inspected.Spec,
				Mode: { Replicated: { Replicas: replicas } },
				version: inspected.Version.Index,
			});
		}

		/** "Restart" in swarm terms : a force-update, which recreates every task's container even though the spec is unchanged. */
		async restartSwarmService(swarmServiceId: string): Promise<void> {
			const service = this.getDocker().getService(swarmServiceId);
			const inspected = await service.inspect();
			await service.update({
				...inspected.Spec,
				TaskTemplate: {
					...inspected.Spec.TaskTemplate,
					ForceUpdate: (inspected.Spec.TaskTemplate.ForceUpdate ?? 0) + 1,
				},
				version: inspected.Version.Index,
			});
		}

		/** Aggregate status across every task of the service, same ContainerStatus vocabulary standalone mode uses. */
		async inspectSwarmServiceStatus(
			swarmServiceId: string,
		): Promise<ContainerStatus> {
			const docker = this.getDocker();
			let spec: { Mode?: { Replicated?: { Replicas?: number } } };
			try {
				spec = (await docker.getService(swarmServiceId).inspect()).Spec;
			} catch {
				return "stopped";
			}
			if ((spec.Mode?.Replicated?.Replicas ?? 0) === 0) {
				return "stopped";
			}
			const tasks = await docker.listTasks({
				filters: JSON.stringify({ service: [swarmServiceId] }),
			});
			const states = tasks.map((t) => t.Status?.State as string);
			if (states.some((s) => s === "running")) {
				return "running";
			}
			if (states.some((s) => s === "failed" || s === "rejected")) {
				return "failed";
			}
			if (states.length === 0) {
				return "pending";
			}
			return "starting";
		}

		/**
		 * The container id of one running task of the service on this node, for
		 * the Terminal tab's exec and pre-backup commands (swarm has no
		 * service-level exec, only container-level, and this app only reaches
		 * the local daemon). Null when every running replica is on another node.
		 */
		async getRunningTaskContainerId(
			swarmServiceId: string,
		): Promise<string | null> {
			const docker = this.getDocker();
			const [tasks, info] = await Promise.all([
				docker.listTasks({
					filters: JSON.stringify({
						"desired-state": ["running"],
						service: [swarmServiceId],
					}),
				}),
				docker.info(),
			]);
			const localNodeId = info?.Swarm?.NodeID;
			const running = tasks.find(
				(task) =>
					task.Status?.State === "running" &&
					(!localNodeId || task.NodeID === localNodeId),
			);
			return running?.Status?.ContainerStatus?.ContainerID ?? null;
		}

		/** Same Web ReadableStream shape as containers.ts's streamLogs, so the Logs tab's route handler doesn't need to know which mode it's in. */
		async streamSwarmServiceLogs(
			swarmServiceId: string,
			tail = 200,
		): Promise<ReadableStream<Uint8Array>> {
			const nodeStream = (await this.getDocker()
				.getService(swarmServiceId)
				.logs({
					follow: true,
					stderr: true,
					stdout: true,
					tail,
				})) as NodeJS.ReadableStream & { destroy: () => void };

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

		/** Swarm-service name this app gives its services, with a random suffix so a redeploy never collides on "name already in use" (mirrors `#containerName` in containers.ts). */
		#swarmServiceName(slug: string, stackSlug?: string | null): string {
			const suffix = crypto.randomUUID().slice(0, 8);
			const prefix = stackSlug ? `${stackSlug}-` : "";
			return `homerun-${prefix}${slug}-${suffix}`;
		}

		/** The currently-running (or last) swarm service for a Homerun service, if any : found by its service-id label, not by name. */
		async #findSwarmService(serviceId: string): Promise<{ ID: string } | null> {
			const services = await this.getDocker().listServices({
				filters: JSON.stringify({
					label: [`${SERVICE_ID_LABEL}=${serviceId}`],
				}),
			});
			return services[0] ? { ID: services[0].ID } : null;
		}
	};
}
