import { query } from "$app/server";
import { z } from "zod";

import { requirePermission, requireUser } from "#lib/server/remote-auth.js";
import {
	INSIGHT_RESOURCES,
	type ResourceInsight,
	ResourceInsightsService,
} from "#lib/services/resource-insights.service.js";
import {
	type SystemStats,
	SystemStatsService,
} from "#lib/services/system-stats.service.js";

export const getSystemStats = query(async (): Promise<SystemStats> => {
	requireUser();
	return await SystemStatsService.getSystemStats();
});

/** What uses the host's CPU, memory or disk right now, for the dashboard's resource rings. */
export const getResourceInsight = query(
	z.enum(INSIGHT_RESOURCES),
	async (resource): Promise<ResourceInsight> => {
		const user = requirePermission("services", "read");
		return await ResourceInsightsService.insight(resource, user.id);
	},
);
