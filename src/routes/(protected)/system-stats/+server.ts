import { json } from "@sveltejs/kit";
import { SystemStatsService } from "$lib/services/system-stats.service";

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const stats = await SystemStatsService.getSystemStats();
	return json(stats);
};
