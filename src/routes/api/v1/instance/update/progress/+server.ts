import { json } from "@sveltejs/kit";
import { SelfUpdateService } from "$lib/services/self-update.service";

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return json({ error: "Forbidden" }, { status: 403 });
	}
	return json(await SelfUpdateService.progress());
};
