import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { iacProjectApiBody } from "#lib/server/validation/iac.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const projects = await IacProjectDTO.list();
	return Response.json(
		await Promise.all(
			projects.map((project) => IacStateService.summary(project)),
		),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, iacProjectApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const project = await IacStateService.createProject({
			...body.data,
			prefix: body.data.prefix ?? "",
			userId: caller.userId,
		});
		return Response.json(await IacStateService.summary(project), {
			status: 201,
		});
	} catch (err) {
		return apiError(err instanceof Error ? err.message : String(err));
	}
};
