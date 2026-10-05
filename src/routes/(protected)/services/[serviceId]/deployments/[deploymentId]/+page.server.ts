import { error } from "@sveltejs/kit";
import { historyTrigger } from "#lib/deploy-trigger.js";
import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { formatDuration } from "#lib/services/notification-messages.js";

export const load = async ({ params, parent }) => {
	const { service } = await parent();
	const deployment = await DeploymentDTO.getForService(
		service.id,
		params.deploymentId,
	);
	if (!deployment) {
		error(404, "Deployment not found");
	}
	const row = deployment.toJSON();
	return {
		deployment: {
			duration: formatDuration(row.startedAt, row.finishedAt),
			environment: row.environment,
			errorMessage: row.errorMessage,
			gitCommit: row.gitCommit,
			gitRef: row.gitRef,
			id: row.id,
			imageRef: row.imageRef,
			log: row.log ?? "",
			startedAt: row.startedAt ?? row.createdAt,
			status: row.status,
			trigger: historyTrigger(row.rollbackOfDeploymentId, row.trigger),
		},
	};
};
