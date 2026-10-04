import { DockerService } from "#lib/services/docker.service.js";

export const POST = async ({ params, request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const data = await request.text();
	if (!data) {
		return Response.json({ error: "Missing data" }, { status: 400 });
	}
	const ok = await DockerService.writeToSession(
		params.sessionId,
		locals.user.id,
		data,
	);
	if (!ok) {
		return Response.json({ error: "Session not found" }, { status: 404 });
	}
	return Response.json({ success: true });
};
