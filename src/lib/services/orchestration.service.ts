import type { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { DeploymentService } from "./deploy.service.ts";
import { DockerService } from "./docker.service.ts";
import { UserService } from "./user.service.ts";

const logger = new Logger("Orchestration");

/** The services that have been deployed at least once, as a container or a swarm service : the ones a daemon move leaves with nothing running. */
export function deployedServices<
	T extends { containerId: string | null; swarmServiceId: string | null },
>(services: T[]): T[] {
	return services.filter(
		(service) =>
			service.containerId !== null || service.swarmServiceId !== null,
	);
}

class OrchestrationServiceClass {
	/**
	 * Boot-time orchestration bookkeeping. On a brand new database it stores
	 * the mode the daemon suits (swarm on a rootful swarm manager, which the
	 * default installer sets up), so an existing instance is never flipped.
	 * Then, when the installer's `--migrate-to-rootful` asked for it, it
	 * queues a redeploy of every deployed service under the first admin and
	 * clears the request.
	 *
	 * @param created Whether this boot created the settings row.
	 */
	async applyOnBoot(
		settings: InstanceSettingsDTO,
		created: boolean,
	): Promise<void> {
		if (created) {
			const mode = await DockerService.detectInitialOrchestrationMode();
			await settings.updateOrchestrationMode(mode);
			logger.info(`New instance, orchestration mode set to ${mode}`);
		}
		if (settings.pendingServiceRedeploy) {
			await this.#redeployAll(settings);
		}
	}

	/** Queues a deploy for every deployed service, then clears the request. Leaves it set when there's no admin to queue the deploys as. */
	async #redeployAll(settings: InstanceSettingsDTO): Promise<void> {
		const adminId = await UserService.firstAdminId();
		if (!adminId) {
			logger.warn("Redeploy requested, but there's no admin to run it as");
			return;
		}
		const services = deployedServices(await ServiceDTO.list());
		for (const service of services) {
			// oxlint-disable-next-line no-await-in-loop -- each enqueue writes its own deployment row, and the queue serialises them anyway
			await DeploymentService.enqueueDeploy({ svc: service, userId: adminId });
		}
		await settings.clearPendingServiceRedeploy();
		logger.info(`Queued a redeploy of ${services.length} service(s)`);
	}
}

export const OrchestrationService = new OrchestrationServiceClass();
