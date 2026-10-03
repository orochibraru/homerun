import { SystemStatsService } from "#lib/services/system-stats.service.js";

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const stats = await SystemStatsService.getSystemStats();
	return Response.json(stats);
};
