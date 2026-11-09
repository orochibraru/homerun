import {
	PipelineService,
	STATS_WINDOW_DAYS,
} from "#lib/services/pipeline.service.js";

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const overview = await PipelineService.globalOverview();
	return Response.json({
		allTimeStats: overview.allTime,
		repositories: overview.repositories.length,
		stats: overview.window,
		windowDays: STATS_WINDOW_DAYS,
	});
};
