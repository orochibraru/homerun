import { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { CancelledJob } from "$lib/dto/job-dto";
import { Logger } from "$lib/logger";
import { DockerService } from "../docker.service.ts";
import { deployJobPayload } from "./payloads.ts";

const logger = new Logger("Queue");

/**
 * Closes the deployments of deploy jobs a cancel just ended (a stack's next
 * service after one failed, a redeploy waiting on a restore that failed or
 * was cancelled): a deploy job that never ran leaves its deployment
 * `pending` and its service showing a deploy in progress. Marks each
 * deployment failed with `reason` and re-reads its service's status from
 * Docker. Errors are logged, never thrown.
 */
export async function closeCancelledDeploys(
	jobs: CancelledJob[],
	reason: string,
): Promise<void> {
	for (const entry of jobs.filter((row) => row.type === "deploy")) {
		const payload = deployJobPayload.safeParse(entry.payload);
		if (!payload.success) {
			continue;
		}
		try {
			// oxlint-disable-next-line no-await-in-loop -- a cancel ends a handful of deploys at most
			const dep = await DeploymentDTO.get(payload.data.deploymentId);
			const status = dep?.toJSON().status;
			if (
				dep &&
				(status === "pending" || status === "pulling" || status === "starting")
			) {
				// oxlint-disable-next-line no-await-in-loop -- see above
				await dep.update({
					errorMessage: reason,
					finishedAt: new Date(),
					status: "failed",
				});
			}
			// oxlint-disable-next-line no-await-in-loop -- see above
			await DockerService.syncServiceStatus(payload.data.serviceId);
		} catch (error) {
			logger.warn(`Couldn't close a cancelled deploy: job=${entry.id}`, error);
		}
	}
}
