import { query } from "$app/server";

import { requireUser } from "#lib/server/remote-auth.js";
import {
	type SystemStats,
	SystemStatsService,
} from "#lib/services/system-stats.service.js";

export const getSystemStats = query(async (): Promise<SystemStats> => {
	requireUser();
	return await SystemStatsService.getSystemStats();
});
