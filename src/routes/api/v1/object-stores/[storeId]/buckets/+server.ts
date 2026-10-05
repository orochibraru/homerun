import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { bucketApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { bucketApiBody } from "#lib/server/validation/api-resources.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const store = await ObjectStoreDTO.get(params.storeId);
	if (!store) {
		return apiError("Not found", 404);
	}
	try {
		const names = await ObjectStorageService.bucketNames(store);
		return Response.json(
			await Promise.all(
				names.map(async (name) =>
					bucketApiJson(
						store.id,
						name,
						(await ObjectStorageService.bucket(store, name)).expirationDays,
					),
				),
			),
		);
	} catch (cause) {
		return apiError(reason(cause), 502);
	}
};

export const POST = async ({ locals, params, request }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const store = await ObjectStoreDTO.get(params.storeId);
	if (!store) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, bucketApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { expirationDays, name } = body.data;
	try {
		await ObjectStorageService.createBucket(store, name);
		if (expirationDays) {
			await ObjectStorageService.setExpiration(store, name, expirationDays);
		}
	} catch (cause) {
		return apiError(reason(cause));
	}
	return Response.json(bucketApiJson(store.id, name, expirationDays ?? null), {
		status: 201,
	});
};
