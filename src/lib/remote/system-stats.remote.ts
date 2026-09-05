import { query } from "$app/server";
import { requireUser } from "$lib/server/remote-auth";
import {
	type SystemStats,
	SystemStatsService,
} from "$lib/services/system-stats.service";

export const getSystemStats = query(async (): Promise<SystemStats> => {
	requireUser();
	return await SystemStatsService.getSystemStats();
});
