import { requireUser } from "#lib/server/remote-auth.js";
import {
	type SystemStats,
	SystemStatsService,
} from "#lib/services/system-stats.service.js";
import { query } from "$app/server";

export const getSystemStats = query(async (): Promise<SystemStats> => {
	requireUser();
	return await SystemStatsService.getSystemStats();
});
