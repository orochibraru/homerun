import { query } from "$app/server";
import { z } from "zod";

import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { TrafficSampleDTO } from "#lib/dto/traffic-sample-dto.js";
import {
	buildLane,
	type Lane,
	LANE_BUCKET_SECONDS,
	laneStart,
} from "#lib/lanes.js";
import { requirePermission } from "#lib/server/remote-auth.js";

export const getLanes = query(
	z.array(z.string()).max(1000),
	async (serviceIds): Promise<Record<string, Lane>> => {
		requirePermission("services", "read");
		if (serviceIds.length === 0) {
			return {};
		}
		const visible = new Set((await ServiceDTO.list()).map((svc) => svc.id));
		const ids = serviceIds.filter((id) => visible.has(id));
		const now = new Date();
		const since = laneStart(now);
		const [traffic, deploys] = await Promise.all([
			TrafficSampleDTO.seriesByService(ids, since, LANE_BUCKET_SECONDS),
			DeploymentDTO.listSinceForServices(ids, since),
		]);
		return Object.fromEntries(
			ids.map((id) => [
				id,
				buildLane(
					traffic.get(id) ?? [],
					deploys.filter((dep) => dep.serviceId === id),
					now,
				),
			]),
		);
	},
);
