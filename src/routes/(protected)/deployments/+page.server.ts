import { historyTrigger } from "$lib/deploy-trigger";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { parseListQuery } from "$lib/server/list-query";
import { formatDuration } from "$lib/services/notification-messages";

export const load = async ({ parent, url }) => {
	const { preferences } = await parent();
	const query = parseListQuery(
		url,
		{ filterKeys: ["status", "trigger", "environment"] },
		preferences.perPage,
	);
	const result = await DeploymentDTO.listPaged(query);
	return {
		deployments: result.items.map((item) => {
			const row = item.deployment.toJSON();
			return {
				duration: formatDuration(row.startedAt, row.finishedAt),
				environment: row.environment,
				errorMessage: row.errorMessage,
				gitCommit: row.gitCommit,
				gitRef: row.gitRef,
				id: row.id,
				imageRef: row.imageRef,
				log: row.log ?? "",
				serviceId: row.serviceId,
				serviceName: item.serviceName,
				serviceSlug: item.serviceSlug,
				startedAt: row.startedAt ?? row.createdAt,
				status: row.status,
				trigger: historyTrigger(row.rollbackOfDeploymentId, row.trigger),
				userName: item.userName,
			};
		}),
		filtered: query.active,
		page: result.page,
		perPage: result.perPage,
		total: result.total,
	};
};
