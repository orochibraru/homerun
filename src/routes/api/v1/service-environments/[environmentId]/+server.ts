import { ServiceDTO } from "#lib/dto/service-dto.js";
import {
	isEnvironmentRow,
	serviceEnvironmentApiJson,
} from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateServiceEnvironmentApiBody } from "#lib/server/validation/api-resources.js";
import {
	EnvironmentError,
	EnvironmentService,
} from "#lib/services/environment.service.js";

/** The environment and the service it belongs to, or null when the id isn't an environment. */
async function environmentAndParent(id: string) {
	const environment = await ServiceDTO.get(id);
	const row = environment?.toJSON();
	if (!(environment && row && isEnvironmentRow(row) && row.previewParentId)) {
		return null;
	}
	const parent = await ServiceDTO.get(row.previewParentId);
	return parent ? { environment, parent } : null;
}

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const found = await environmentAndParent(params.environmentId);
	return found
		? Response.json(serviceEnvironmentApiJson(found.environment.toJSON()))
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const found = await environmentAndParent(params.environmentId);
	if (!found) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateServiceEnvironmentApiBody);
	if ("response" in body) {
		return body.response;
	}
	const current = serviceEnvironmentApiJson(found.environment.toJSON());
	try {
		const environment = await EnvironmentService.update(
			found.parent,
			found.environment.id,
			{
				domain:
					body.data.domain === undefined ? current.domain : body.data.domain,
				envOverrides: body.data.envOverrides ?? {},
				ref: body.data.ref ?? current.ref,
			},
		);
		return Response.json(serviceEnvironmentApiJson(environment.toJSON()));
	} catch (err) {
		if (err instanceof EnvironmentError) {
			return apiError(err.message);
		}
		throw err;
	}
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const found = await environmentAndParent(params.environmentId);
	if (!found) {
		return apiError("Not found", 404);
	}
	try {
		await EnvironmentService.delete(found.parent, found.environment.id);
	} catch (err) {
		if (err instanceof EnvironmentError) {
			return apiError(err.message);
		}
		throw err;
	}
	return new Response(null, { status: 204 });
};
