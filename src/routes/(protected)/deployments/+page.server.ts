import { historyTrigger } from "#lib/deploy-trigger.js";
import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { deploymentEnvironments } from "#lib/release-channels.js";
import { parseListQuery } from "#lib/server/list-query.js";
import { formatDuration } from "#lib/services/notification-messages.js";

export const load = async ({ parent, url }) => {
	const { preferences } = await parent();
	const query = parseListQuery(
		url,
		{ filterKeys: ["status", "trigger", "environment"] },
		preferences.perPage,
	);
	const listing = DeploymentDTO.listPaged(query).then((result) => ({
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
				serviceId: row.serviceId,
				serviceName: item.serviceName,
				serviceSlug: item.serviceSlug,
				startedAt: row.startedAt ?? row.createdAt,
				status: row.status,
				trigger: historyTrigger(row.rollbackOfDeploymentId, row.trigger),
				userName: item.userName,
			};
		}),
		page: result.page,
		perPage: result.perPage,
		total: result.total,
	}));
	return {
		environments: deploymentEnvironments(
			await DeploymentDTO.listEnvironments(),
		),
		filtered: query.active,
		listing,
	};
};
