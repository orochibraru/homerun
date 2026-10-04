import { DockerService } from "#lib/services/docker.service.js";

export const POST = ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (DockerService.ownsSession(params.sessionId, locals.user.id)) {
		DockerService.closeSession(params.sessionId);
	}
	return Response.json({ success: true });
};
