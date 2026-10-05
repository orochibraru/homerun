import { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceVolumeDTO } from "#lib/dto/service-volume-dto.js";
import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { volumeMountApiBody } from "#lib/server/validation/api-resources.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await ServiceVolumeDTO.list()).map((mount) => mount.toJSON()),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, volumeMountApiBody);
	if ("response" in body) {
		return body.response;
	}
	const [svc, volume] = await Promise.all([
		ServiceDTO.get(body.data.serviceId),
		StorageVolumeDTO.get(body.data.volumeId),
	]);
	if (!(svc && volume)) {
		return apiError("The service and the volume must both exist.", 404);
	}
	const mount = await ServiceVolumeDTO.attach(body.data);
	return Response.json(mount.toJSON(), { status: 201 });
};
