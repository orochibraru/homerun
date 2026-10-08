import { error } from "@sveltejs/kit";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

const PASSED_HEADERS = [
	"content-length",
	"content-type",
	"etag",
	"last-modified",
];

export const GET = async ({ locals, params, url }) => {
	if (!locals.user) {
		error(401, "Sign in first.");
	}
	const key = url.searchParams.get("key") ?? "";
	const store = key ? await ObjectStoreDTO.get(params.storeId) : null;
	if (!store) {
		error(404, "Not found");
	}
	const upstream = await (await ObjectStorageService.client(store))
		.objectResponse(params.bucket, key, null)
		.catch(() => error(503, "The object store can't be reached."));
	if (!upstream.ok) {
		error(upstream.status === 404 ? 404 : 502, "The object can't be read.");
	}
	const headers = new Headers();
	for (const name of PASSED_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}
	const filename = key.split("/").pop() ?? "download";
	headers.set(
		"content-disposition",
		`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
	);
	return new Response(upstream.body, { headers });
};
