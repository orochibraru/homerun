import { ServiceVolumeDTO } from "#lib/dto/service-volume-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateVolumeMountApiBody } from "#lib/server/validation/api-resources.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const mount = await ServiceVolumeDTO.get(params.mountId);
	return mount ? Response.json(mount.toJSON()) : apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const mount = await ServiceVolumeDTO.get(params.mountId);
	if (!mount) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateVolumeMountApiBody);
	if ("response" in body) {
		return body.response;
	}
	if (Object.keys(body.data).length > 0) {
		await mount.update(body.data);
	}
	return Response.json(mount.toJSON());
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const mount = await ServiceVolumeDTO.get(params.mountId);
	if (!mount) {
		return apiError("Not found", 404);
	}
	await mount.detach();
	return new Response(null, { status: 204 });
};
