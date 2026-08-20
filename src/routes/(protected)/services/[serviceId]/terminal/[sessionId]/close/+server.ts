import { json } from "@sveltejs/kit";
import { DockerService } from "$lib/services/docker.service";

export const POST = ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	if (DockerService.ownsSession(params.sessionId, locals.user.id)) {
		DockerService.closeSession(params.sessionId);
	}
	return json({ success: true });
};
