import { json } from "@sveltejs/kit";
import { DockerService } from "$lib/services/docker.service";

export const POST = async ({ params, request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const data = await request.text();
	if (!data) {
		return json({ error: "Missing data" }, { status: 400 });
	}
	const ok = await DockerService.writeToSession(
		params.sessionId,
		locals.user.id,
		data,
	);
	if (!ok) {
		return json({ error: "Session not found" }, { status: 404 });
	}
	return json({ success: true });
};
