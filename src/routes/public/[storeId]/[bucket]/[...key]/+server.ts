import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { PublicBucketDTO } from "#lib/dto/public-bucket-dto.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

const PASSED_HEADERS = [
	"accept-ranges",
	"cache-control",
	"content-disposition",
	"content-length",
	"content-range",
	"content-type",
	"etag",
	"last-modified",
];

const notFound = () => new Response("Not found", { status: 404 });

export const GET = async ({ params, request }) => {
	if (
		!params.key ||
		!(await PublicBucketDTO.isPublic(params.storeId, params.bucket))
	) {
		return notFound();
	}
	const store = await ObjectStoreDTO.get(params.storeId);
	if (!store) {
		return notFound();
	}
	const upstream = await ObjectStorageService.client(store)
		.then((client) =>
			client.objectResponse(
				params.bucket,
				params.key,
				request.headers.get("range"),
			),
		)
		.catch(() => null);
	if (!upstream) {
		return new Response("The object store can't be reached.", {
			status: 503,
		});
	}
	if (upstream.status === 404 || upstream.status === 403) {
		return notFound();
	}
	if (!upstream.ok && upstream.status !== 416) {
		return new Response("The object store refused the request.", {
			status: 502,
		});
	}
	const headers = new Headers();
	for (const name of PASSED_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}
	return new Response(upstream.body, { headers, status: upstream.status });
};
