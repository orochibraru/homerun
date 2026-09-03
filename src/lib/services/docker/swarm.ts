import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { ContainerStatus } from "$lib/types";
import type { BaseDockerService, Constructor } from "./base.ts";
import type {
	PullImageParams,
	RegistryAuth,
	VolumeMountParams,
} from "./containers.ts";
import { buildContainerLabels, SERVICE_ID_LABEL } from "./labels.ts";

const logger = new Logger("Swarm");

/** What this mixin needs from whatever's ahead of it in the merge chain (see docker.service.ts) : the container mixin's pullImage. */
interface RequiresContainerMixin {
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
}

export interface CreateSwarmServiceParams {
	auth?: RegistryAuth;
	authRequired?: boolean;
	containerPort: number;
	cpuLimit?: string | null;
	customDomain?: string | null;
	dnsResolvable?: boolean;
	envVars: Record<string, string>;
	image: string;
	memoryLimitMb?: number | null;
	portProtocol?: "tcp" | "udp" | "both";
	projectSlug?: string | null;
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
 * Requires the host's own Docker daemon to already be swarm-active
 * (`docker swarm init`, the admin's own one-time step : this app never
 * runs that itself, same "don't touch host-level daemon state" boundary as
 * the rootless-Docker installer). Traefik must be configured with its
 * Docker provider in swarm mode (`--providers.docker.swarmMode=true`) to
 * discover these services : a compose.yaml change the admin makes once,
 * same pattern as the custom-SSL dynamic-config-dir opt-in.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerSwarmMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
>(Base: TBase) {
	return class DockerSwarmService extends Base {
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

		/** Pulls the image, then creates (or replaces) the swarm service backing one Homerun service. */
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

		#taskTemplateFor(params: CreateSwarmServiceParams) {
			return {
				ContainerSpec: {
					Env: Object.entries(params.envVars).map(([k, v]) => `${k}=${v}`),
					Image: `${params.image}:${params.tag}`,
					Labels: {
						[SERVICE_ID_LABEL]: params.serviceId,
						"homerun.managed": "true",
					},
					Mounts: (params.volumes ?? []).map((v) => ({
						ReadOnly: v.readOnly ?? false,
						Source: v.source,
						Target: v.containerPath,
						Type: "bind" as const,
					})),
				},
				Networks: [{ Target: config.docker.networkName }],
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
					Condition: params.restartPolicy === "no" ? "none" : "any",
				},
			};
		}

		async createAndStartSwarmService(
			params: CreateSwarmServiceParams,
			onProgress?: (line: string) => void,
		): Promise<{ swarmServiceId: string }> {
			const docker = this.getDocker();
			await this.ensureSwarmNetwork(config.docker.networkName);

			const existing = await this.#findSwarmService(params.serviceId);
			if (existing) {
				onProgress?.(`Removing previous service ${existing.ID}...`);
				await docker.getService(existing.ID).remove();
			}

			await this.#prePullImage(params, onProgress);

			onProgress?.("Creating swarm service...");
			// Swarm has no per-service EXPOSE equivalent to declare protocols
			// the way standalone containers do, and no port is published
			// either way (matching the rest of this app's "no host port
			// publishing by design" stance), so params.portProtocol isn't
			// attached to anything dockerode's swarm API accepts here.
			const created = await docker.createService({
				Labels: buildContainerLabels({
					authRequired: params.authRequired,
					containerPort: params.containerPort,
					customDomain: params.customDomain,
					dnsResolvable: params.dnsResolvable,
					projectSlug: params.projectSlug,
					serviceId: params.serviceId,
					slug: params.slug,
				}),
				Mode: { Replicated: { Replicas: params.replicas } },
				Name: this.#swarmServiceName(params.slug, params.projectSlug),
				TaskTemplate: this.#taskTemplateFor(params),
			});

			logger.info(
				`Swarm service created: id=${created.id ?? created.ID} service=${params.serviceId}`,
			);
			return { swarmServiceId: created.id ?? created.ID };
		}

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

		/** The container id backing the service's one running task, for the Terminal tab's exec (swarm has no service-level exec, only container-level). */
		async getRunningTaskContainerId(
			swarmServiceId: string,
		): Promise<string | null> {
			const docker = this.getDocker();
			const tasks = await docker.listTasks({
				filters: JSON.stringify({
					"desired-state": ["running"],
					service: [swarmServiceId],
				}),
			});
			const running = tasks.find((t) => t.Status?.State === "running");
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

		#swarmServiceName(slug: string, projectSlug?: string | null): string {
			const suffix = crypto.randomUUID().slice(0, 8);
			const prefix = projectSlug ? `${projectSlug}-` : "";
			return `homerun-${prefix}${slug}-${suffix}`;
		}

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
