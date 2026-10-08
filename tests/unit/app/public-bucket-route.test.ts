import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { GET } = await import(
	"../../../src/routes/public/[storeId]/[bucket]/[...key]/+server"
);
const { PublicBucketDTO } = await import(
	"../../../src/lib/dto/public-bucket-dto"
);
const { ObjectStoreDTO } = await import(
	"../../../src/lib/dto/object-store-dto"
);
const { ObjectStorageService } = await import(
	"../../../src/lib/services/object-storage.service"
);

type Store = NonNullable<Awaited<ReturnType<typeof ObjectStoreDTO.get>>>;
type Client = Awaited<ReturnType<typeof ObjectStorageService.client>>;
type Event = Parameters<typeof GET>[0];

const restorers: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const restorer of restorers.splice(0)) {
		restorer.mockRestore();
	}
});

function request(range: string | null = null): Event {
	return {
		params: { bucket: "assets", key: "img/logo.png", storeId: "s1" },
		request: new Request("http://localhost/public/s1/assets/img/logo.png", {
			headers: range ? { range } : {},
		}),
	} as unknown as Event;
}

function store(upstream: Response | Error, isPublic = true) {
	const objectResponse = mock(
		async (_bucket: string, _key: string, _range: string | null) => {
			if (upstream instanceof Error) {
				throw upstream;
			}
			return upstream;
		},
	);
	restorers.push(
		spyOn(PublicBucketDTO, "isPublic").mockResolvedValue(isPublic),
		spyOn(ObjectStoreDTO, "get").mockResolvedValue({} as Store),
		spyOn(ObjectStorageService, "client").mockResolvedValue({
			objectResponse,
		} as unknown as Client),
	);
	return objectResponse;
}

describe("the public bucket route", () => {
	test("hides a private bucket's objects", async () => {
		const fetched = store(new Response("secret"), false);
		const response = await GET(request());
		expect(response.status).toBe(404);
		expect(fetched).not.toHaveBeenCalled();
	});

	test("streams a public object with its headers, passing the range on", async () => {
		const fetched = store(
			new Response("PNG", {
				headers: {
					"content-range": "bytes 0-2/3",
					"content-type": "image/png",
					"x-amz-request-id": "internal",
				},
				status: 206,
			}),
		);
		const response = await GET(request("bytes=0-2"));
		expect(fetched).toHaveBeenCalledWith("assets", "img/logo.png", "bytes=0-2");
		expect(response.status).toBe(206);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("content-range")).toBe("bytes 0-2/3");
		expect(response.headers.get("x-amz-request-id")).toBeNull();
		expect(await response.text()).toBe("PNG");
	});

	test("answers 404 for a missing object and 503 when the store is down", async () => {
		store(new Response("NoSuchKey", { status: 404 }));
		expect((await GET(request())).status).toBe(404);
		restorers.splice(0).forEach((restorer) => restorer.mockRestore());
		store(new Error("connection refused"));
		expect((await GET(request())).status).toBe(503);
	});
});
