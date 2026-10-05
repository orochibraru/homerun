import { TemplateDTO } from "#lib/dto/template-dto.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const template = await TemplateDTO.get(params.templateId);
	return template
		? Response.json(template.toJSON())
		: apiError("Not found", 404);
};
