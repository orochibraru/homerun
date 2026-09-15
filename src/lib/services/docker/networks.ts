import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import { MANAGED_LABEL } from "./labels.ts";

const logger = new Logger("Docker");

/** Deterministic : no need to persist a network id anywhere, it's derived from the project id. */
export function projectNetworkName(projectId: string): string {
	return `${PROJECT_NETWORK_PREFIX}${projectId}`;
}

export const PROJECT_NETWORK_PREFIX = "homerun-project-";

export interface OrphanNetwork {
	containersAttached: number;
	id: string;
	name: string;
	projectId: string;
}

/** The project id a project network's name encodes, or null for any other network. */
export function projectIdFromNetworkName(name: string): string | null {
	return name.startsWith(PROJECT_NETWORK_PREFIX)
		? name.slice(PROJECT_NETWORK_PREFIX.length) || null
		: null;
}

/** Per-project Docker network lifecycle : create/remove/attach. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerNetworkMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerNetworkService extends Base {
		/** Creates a bridge network if it doesn't already exist. Idempotent. */
		async #ensureNetwork(name: string): Promise<boolean> {
			try {
				await this.getDocker().createNetwork({
					CheckDuplicate: true,
					Driver: "bridge",
					Labels: { [MANAGED_LABEL]: "true" },
					Name: name,
				});
				return true;
			} catch (err) {
				// 409 = already exists : fine, idempotent by design.
				const status = (err as { statusCode?: number }).statusCode;
				if (status !== 409) {
					throw err;
				}
				return false;
			}
		}

		/**
		 * The shared network every bridge-mode container joins, and the one
		 * Traefik discovers services on. Compose creates it for a
		 * compose-run instance, but nothing does for a bare `bun run start`,
		 * and Docker Cleanup's network prune can remove it once the last
		 * container detaches, so every deploy re-asserts it rather than
		 * assuming a one-time `docker network create`.
		 */
		async ensureSharedNetwork(): Promise<void> {
			if (await this.#ensureNetwork(config.docker.networkName)) {
				logger.info(`Shared network created: ${config.docker.networkName}`);
			}
		}

		/** Creates the project's dedicated network if it doesn't already exist. Idempotent. */
		async ensureProjectNetwork(projectId: string): Promise<void> {
			const name = projectNetworkName(projectId);
			if (await this.#ensureNetwork(name)) {
				logger.info(`Project network created: ${name}`);
			}
		}

		/** Removes the project's dedicated network. Safe to call even if it's already gone. */
		async removeProjectNetwork(projectId: string): Promise<void> {
			const name = projectNetworkName(projectId);
			try {
				await this.getDocker().getNetwork(name).remove();
				logger.info(`Project network removed: ${name}`);
			} catch {
				// Already gone, or never existed : nothing to clean up.
			}
		}

		/**
		 * Project networks whose project row is gone : every
		 * `homerun-project-*` network on the daemon minus the ids still in
		 * `liveProjectIds`. Read-only, so a caller can show them before
		 * removing any.
		 */
		async findOrphanProjectNetworks(
			liveProjectIds: Set<string>,
		): Promise<OrphanNetwork[]> {
			const networks = await this.getDocker().listNetworks();
			const orphans: OrphanNetwork[] = [];
			for (const net of networks) {
				const projectId = projectIdFromNetworkName(net.Name ?? "");
				if (!projectId || liveProjectIds.has(projectId)) {
					continue;
				}
				orphans.push({
					containersAttached: Object.keys(net.Containers ?? {}).length,
					id: net.Id,
					name: net.Name,
					projectId,
				});
			}
			return orphans;
		}

		/**
		 * Removes those of them nothing is attached to. A network with live
		 * containers on it is left alone and reported back : its containers
		 * are orphans too, and tearing their network out from under them
		 * would be a worse surprise than the leak.
		 */
		async reclaimOrphanProjectNetworks(
			liveProjectIds: Set<string>,
		): Promise<{ removed: string[]; skipped: OrphanNetwork[] }> {
			const orphans = await this.findOrphanProjectNetworks(liveProjectIds);
			const removed: string[] = [];
			const skipped: OrphanNetwork[] = [];
			for (const orphan of orphans) {
				if (orphan.containersAttached > 0) {
					skipped.push(orphan);
					continue;
				}
				// biome-ignore lint/performance/noAwaitInLoops: one removal at a time, and a failure has to be attributed to its own network
				const gone = await this.getDocker()
					.getNetwork(orphan.id)
					.remove()
					.then(() => true)
					.catch((err: unknown) => {
						logger.warn(`Couldn't remove orphan network ${orphan.name}`, err);
						return false;
					});
				if (gone) {
					removed.push(orphan.name);
				} else {
					skipped.push(orphan);
				}
			}
			if (removed.length > 0) {
				logger.info(
					`Reclaimed ${removed.length} orphan project network(s): ${removed.join(", ")}`,
				);
			}
			return { removed, skipped };
		}

		/**
		 * Attaches a container to its project's network under a stable DNS
		 * alias (the service's slug) : so other containers in the same
		 * project can reach it as `http://<slug>:<port>` regardless of the
		 * container's own (randomized, see docker/containers.ts) name.
		 */
		async connectToProjectNetwork(
			containerId: string,
			projectId: string,
			alias: string,
		): Promise<void> {
			await this.ensureProjectNetwork(projectId);
			const name = projectNetworkName(projectId);
			await this.getDocker()
				.getNetwork(name)
				.connect({
					Container: containerId,
					EndpointConfig: { Aliases: [alias] },
				});
		}
	};
}
