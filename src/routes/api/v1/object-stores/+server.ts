import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { objectStoreApiBody } from "#lib/server/validation/api-resources.js";
import { parseObjectStoreForm } from "#lib/server/validation/object-store.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const builtinOn =
		(await InstanceSettingsDTO.get()).toJSON().garageEnabled === true;
	return Response.json(
		(await ObjectStoreDTO.list())
			.filter((store) => store.kind !== "garage" || builtinOn)
			.map((store) => store.summary()),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, objectStoreApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { error, values } = parseObjectStoreForm(
		new Map(Object.entries(body.data)),
		true,
	);
	if (error) {
		return apiError(error);
	}
	try {
		const store = await ObjectStorageService.createStore(values, caller.userId);
		return Response.json(store.summary(), { status: 201 });
	} catch (cause) {
		return apiError(cause instanceof Error ? cause.message : String(cause));
	}
};
