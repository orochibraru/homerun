import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import { MANAGED_LABEL } from "./labels.ts";

const logger = new Logger("Docker");

/** Deterministic : no need to persist a network id anywhere, it's derived from the stack id. */
export function stackNetworkName(stackId: string): string {
	return `${STACK_NETWORK_PREFIX}${stackId}`;
}

export const STACK_NETWORK_PREFIX = "homerun-stack-";

export interface OrphanNetwork {
	containersAttached: number;
	id: string;
	name: string;
	stackId: string;
}

/** The stack id a stack network's name encodes, or null for any other network. */
export function stackIdFromNetworkName(name: string): string | null {
	return name.startsWith(STACK_NETWORK_PREFIX)
		? name.slice(STACK_NETWORK_PREFIX.length) || null
		: null;
}

/** Per-stack Docker network lifecycle : create/remove/attach. */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
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

		/** Creates the stack's dedicated network if it doesn't already exist. Idempotent. */
		async ensureStackNetwork(stackId: string): Promise<void> {
			const name = stackNetworkName(stackId);
			if (await this.#ensureNetwork(name)) {
				logger.info(`Stack network created: ${name}`);
			}
		}

		/** Removes the stack's dedicated network. Safe to call even if it's already gone. */
		async removeStackNetwork(stackId: string): Promise<void> {
			const name = stackNetworkName(stackId);
			try {
				await this.getDocker().getNetwork(name).remove();
				logger.info(`Stack network removed: ${name}`);
			} catch {
				// Already gone, or never existed : nothing to clean up.
			}
		}

		/**
		 * Stack networks whose stack row is gone : every
		 * `homerun-stack-*` network on the daemon minus the ids still in
		 * `liveStackIds`. Read-only, so a caller can show them before
		 * removing any.
		 */
		async findOrphanStackNetworks(
			liveStackIds: Set<string>,
		): Promise<OrphanNetwork[]> {
			const networks = await this.getDocker().listNetworks();
			const orphans: OrphanNetwork[] = [];
			for (const net of networks) {
				const stackId = stackIdFromNetworkName(net.Name ?? "");
				if (!stackId || liveStackIds.has(stackId)) {
					continue;
				}
				orphans.push({
					containersAttached: Object.keys(net.Containers ?? {}).length,
					id: net.Id,
					name: net.Name,
					stackId,
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
		async reclaimOrphanStackNetworks(
			liveStackIds: Set<string>,
		): Promise<{ removed: string[]; skipped: OrphanNetwork[] }> {
			const orphans = await this.findOrphanStackNetworks(liveStackIds);
			const removed: string[] = [];
			const skipped: OrphanNetwork[] = [];
			for (const orphan of orphans) {
				if (orphan.containersAttached > 0) {
					skipped.push(orphan);
					continue;
				}
				// oxlint-disable-next-line no-await-in-loop -- one removal at a time, and a failure has to be attributed to its own network
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
					`Reclaimed ${removed.length} orphan stack network(s): ${removed.join(", ")}`,
				);
			}
			return { removed, skipped };
		}

		/**
		 * Attaches a container to its stack's network under a stable DNS
		 * alias (the service's slug) : so other containers in the same
		 * stack can reach it as `http://<slug>:<port>` regardless of the
		 * container's own (randomized, see docker/containers.ts) name.
		 */
		async connectToStackNetwork(
			containerId: string,
			stackId: string,
			alias: string,
		): Promise<void> {
			await this.ensureStackNetwork(stackId);
			const name = stackNetworkName(stackId);
			await this.getDocker()
				.getNetwork(name)
				.connect({
					Container: containerId,
					EndpointConfig: { Aliases: [alias] },
				});
		}
	};
}
