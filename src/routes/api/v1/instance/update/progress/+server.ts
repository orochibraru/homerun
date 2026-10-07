import { SelfUpdateService } from "#lib/services/self-update.service.js";

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	return Response.json(await SelfUpdateService.progress());
};
