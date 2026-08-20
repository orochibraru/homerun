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
		/** Creates the project's dedicated network if it doesn't already exist. Idempotent. */
		async ensureProjectNetwork(projectId: string): Promise<void> {
			const name = projectNetworkName(projectId);
			try {
				await this.getDocker().createNetwork({
					CheckDuplicate: true,
					Driver: "bridge",
					Labels: { [MANAGED_LABEL]: "true" },
					Name: name,
				});
				logger.info(`Project network created: ${name}`);
			} catch (err) {
				// 409 = already exists : fine, idempotent by design.
				const status = (err as { statusCode?: number }).statusCode;
				if (status !== 409) {
					throw err;
				}
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
