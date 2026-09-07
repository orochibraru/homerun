import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import { MANAGED_LABEL } from "./labels.ts";

const logger = new Logger("Docker");

/** Deterministic : no need to persist a network id anywhere, it's derived from the project id. */
export function projectNetworkName(projectId: string): string {
	return `homerun-project-${projectId}`;
}

/** Per-project Docker network lifecycle : create/remove/attach. */
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
