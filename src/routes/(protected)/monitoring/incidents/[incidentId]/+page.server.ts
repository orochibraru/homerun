import { error } from "@sveltejs/kit";

import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { ResourceIncidentDTO } from "#lib/dto/resource-incident-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { TrafficSampleDTO } from "#lib/dto/traffic-sample-dto.js";

export const load = async ({ params }) => {
	const incident = await ResourceIncidentDTO.get(params.incidentId);
	if (!incident) {
		error(404, "Incident not found");
	}
	const row = incident.toJSON();
	const startedAt = new Date(row.startedAt);
	const endedAt = row.resolvedAt ? new Date(row.resolvedAt) : new Date();
	const before = new Date(
		startedAt.getTime() - (endedAt.getTime() - startedAt.getTime()),
	);
	const [host, settings, serviceIds] = await Promise.all([
		row.remoteHostId ? RemoteHostDTO.get(row.remoteHostId) : null,
		InstanceSettingsDTO.get(),
		row.remoteHostId
			? []
			: ServiceDTO.list().then((services) =>
					services.map((service) => service.id),
				),
	]);
	const [during, previously] = await Promise.all([
		TrafficSampleDTO.totals(serviceIds, startedAt, endedAt),
		TrafficSampleDTO.totals(serviceIds, before, startedAt),
	]);
	return {
		hostName: row.remoteHostId ? (host?.name ?? "A remote host") : null,
		incident: row,
		thresholds: settings.resourceThresholds,
		traffic: row.remoteHostId
			? null
			: {
					before: previously,
					during,
					minutes: Math.max(
						1,
						(endedAt.getTime() - startedAt.getTime()) / 60_000,
					),
				},
	};
};
