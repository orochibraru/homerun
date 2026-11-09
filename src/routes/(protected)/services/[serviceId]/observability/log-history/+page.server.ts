import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { LogHistoryService } from "#lib/services/log-history.service.js";

export const load = async ({ parent, url }) => {
	const { service } = await parent();
	const [history, deployments] = await Promise.all([
		LogHistoryService.view({ serviceId: service.id }, url),
		DeploymentDTO.listForService(service.id, 50),
	]);
	return {
		deployments: deployments.map((dep) => {
			const row = dep.toJSON();
			return {
				createdAt: row.createdAt,
				gitCommit: row.gitCommit,
				id: row.id,
				imageRef: row.imageRef,
			};
		}),
		history,
	};
};
