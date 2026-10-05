import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateObjectStoreApiBody } from "#lib/server/validation/api-resources.js";
import { parseObjectStoreForm } from "#lib/server/validation/object-store.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

const BUILTIN_REFUSED =
	"The built-in store is managed from Object Storage → Built-in.";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const store = await ObjectStoreDTO.get(params.storeId);
	return store ? Response.json(store.summary()) : apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const store = await ObjectStoreDTO.get(params.storeId);
	if (!store) {
		return apiError("Not found", 404);
	}
	if (store.kind === "garage") {
		return apiError(BUILTIN_REFUSED, 409);
	}
	const body = await readApiBody(request, updateObjectStoreApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { error, values } = parseObjectStoreForm(
		new Map(Object.entries({ ...store.summary(), ...body.data })),
		false,
	);
	if (error) {
		return apiError(error);
	}
	try {
		await ObjectStorageService.updateStore(store, values);
	} catch (cause) {
		return apiError(cause instanceof Error ? cause.message : String(cause));
	}
	return Response.json(store.summary());
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const store = await ObjectStoreDTO.get(params.storeId);
	if (!store) {
		return apiError("Not found", 404);
	}
	if (store.kind === "garage") {
		return apiError(BUILTIN_REFUSED, 409);
	}
	await store.delete();
	return new Response(null, { status: 204 });
};
