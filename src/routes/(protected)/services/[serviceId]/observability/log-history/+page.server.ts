import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { ServiceLogDTO } from "#lib/dto/service-log-dto.js";
import { isLogRange } from "#lib/logs/history.js";
import { LogHistoryService } from "#lib/services/log-history.service.js";

export const load = async ({ parent, url }) => {
	const { service } = await parent();
	const range = url.searchParams.get("range");
	const [result, deployments, instances, oldest, retentionDays] =
		await Promise.all([
			LogHistoryService.search(service.id, url.searchParams, "24h"),
			DeploymentDTO.listForService(service.id, 50),
			ServiceLogDTO.instances(service.id),
			ServiceLogDTO.oldest(service.id),
			LogHistoryService.retentionDays(),
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
		error: result.error,
		filters: {
			deploymentId: result.query.deploymentId ?? "",
			from: url.searchParams.get("from") ?? "",
			instance: result.query.instance ?? "",
			paged: result.query.before !== null,
			q: result.query.q,
			range: isLogRange(range) ? range : "24h",
			regex: result.query.regex,
			stream: result.query.stream ?? "",
			to: url.searchParams.get("to") ?? "",
		},
		instances,
		oldest,
		page: result.page,
		retentionDays,
	};
};
