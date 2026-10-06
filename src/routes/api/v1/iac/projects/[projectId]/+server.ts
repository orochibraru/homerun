import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const project = await IacProjectDTO.get(params.projectId);
	return project
		? Response.json(await IacStateService.summary(project))
		: apiError("That state project doesn't exist.", 404);
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		return apiError("That state project doesn't exist.", 404);
	}
	await project.delete();
	return Response.json({ success: true });
};
