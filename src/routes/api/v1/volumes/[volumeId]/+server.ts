import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateVolumeApiBody } from "#lib/server/validation/api-resources.js";
import {
	VolumeSettingsError,
	VolumeSettingsService,
} from "#lib/services/volume-settings.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const volume = await StorageVolumeDTO.get(params.volumeId);
	return volume ? Response.json(volume.toJSON()) : apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateVolumeApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		await VolumeSettingsService.apply(volume, body.data);
	} catch (err) {
		if (err instanceof VolumeSettingsError) {
			return apiError(err.message);
		}
		throw err;
	}
	return Response.json(volume.toJSON());
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		return apiError("Not found", 404);
	}
	await volume.delete();
	return new Response(null, { status: 204 });
};
