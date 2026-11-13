import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { ResourceIncidentDTO } from "#lib/dto/resource-incident-dto.js";
import { parseListQuery } from "#lib/server/list-query.js";
import { CapacityService } from "#lib/services/capacity.service.js";

export const load = async ({ parent, url }) => {
	const { preferences } = await parent();
	const query = parseListQuery(
		url,
		{ filterKeys: ["host", "status", "resource", "level"] },
		preferences.perPage,
	);
	const [paged, hosts] = await Promise.all([
		ResourceIncidentDTO.listPaged(query),
		RemoteHostDTO.list(),
	]);
	return {
		filtered: query.active,
		hosts: hosts.map((host) => ({
			enabled: host.enabled,
			id: host.id,
			measured: host.kind === "agent",
			name: host.name,
		})),
		incidents: paged.items.map((incident) => incident.summary()),
		page: paged.page,
		perPage: paged.perPage,
		total: paged.total,
		watched: CapacityService.watched(),
	};
};
