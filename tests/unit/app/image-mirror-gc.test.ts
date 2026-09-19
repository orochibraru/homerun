import { describe, expect, test } from "bun:test";
import { splitImageRef } from "../../../src/lib/image-ref";
import { mirrorRepository } from "../../../src/lib/services/docker/image-scan-refs";
import {
	isValidRepository,
	KEEP_TAG_PREFIX,
	keepTagFor,
	MANIFEST_ACCEPT,
	MirrorRegistryClient,
	mirrorKeepSet,
	nextCatalogPath,
	parseDuKilobytes,
	planMirrorGc,
} from "../../../src/lib/services/docker/mirror-registry";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const ALPINE = "docker.io/library/alpine";
const NGINX = "docker.io/library/nginx";

describe("mirror keep set", () => {
	test("maps image refs onto mirror repositories", () => {
		expect(mirrorRepository("alpine", "3.20")).toBe(ALPINE);
		expect(mirrorRepository("ghcr.io/Org/App", "1")).toBe("ghcr.io/org/app");
		expect(splitImageRef(`alpine:3.20@${digest("a")}`)).toEqual({
			image: "alpine",
			tag: "3.20",
		});
		expect(splitImageRef("localhost:5000/app")).toEqual({
			image: "localhost:5000/app",
			tag: "latest",
		});
	});

	test("keeps the current tag, every retained revision digest and the last N distinct scans", () => {
		const keep = mirrorKeepSet(
			[
				{
					deployed: [
						{ digest: digest("d"), imageRef: "alpine:3.20" },
						{ digest: digest("f"), imageRef: "alpine:3.19" },
					],
					image: "alpine",
					scans: [
						{ digest: digest("a"), imageRef: `alpine:3.20@${digest("a")}` },
						{ digest: digest("a"), imageRef: `alpine:3.20@${digest("a")}` },
						{ digest: digest("b"), imageRef: `alpine:3.19@${digest("b")}` },
						{ digest: digest("c"), imageRef: `alpine:3.18@${digest("c")}` },
					],
					tag: "3.20",
				},
				{
					deployed: [{ digest: digest("e"), imageRef: "" }],
					image: "redis",
					scans: [],
					tag: "7",
				},
				{
					deployed: [{ digest: "not-a-digest", imageRef: "nginx:1" }],
					image: "nginx",
					scans: [],
					tag: "1",
				},
			],
			2,
		);
		expect(keep.tags).toEqual([
			{ repository: ALPINE, tag: "3.20" },
			{ repository: "docker.io/library/redis", tag: "7" },
			{ repository: NGINX, tag: "1" },
		]);
		expect(keep.digests).toEqual([
			{ digest: digest("d"), repository: ALPINE },
			{ digest: digest("f"), repository: ALPINE },
			{ digest: digest("a"), repository: ALPINE },
			{ digest: digest("b"), repository: ALPINE },
		]);
	});
});

describe("planMirrorGc", () => {
	test("deletes unreferenced manifests, pins untagged keepers, drops dead repositories", () => {
		const inventory = [
			{ digest: digest("1"), repository: ALPINE, tag: "3.20" },
			{ digest: digest("1"), repository: ALPINE, tag: "latest" },
			{ digest: digest("2"), repository: ALPINE, tag: "3.19" },
			{ digest: digest("3"), repository: ALPINE, tag: "3.18" },
			{ digest: digest("9"), repository: ALPINE, tag: keepTagFor(digest("9")) },
			{ digest: digest("5"), repository: NGINX, tag: "1.27" },
		];
		const plan = planMirrorGc(inventory, [ALPINE, NGINX, "ghcr.io/empty"], {
			digests: [
				{ digest: digest("2"), repository: ALPINE },
				{ digest: digest("7"), repository: ALPINE },
				{ digest: digest("8"), repository: "docker.io/library/gone" },
			],
			tags: [{ repository: ALPINE, tag: "3.20" }],
		});
		expect(plan.deletes).toEqual([
			{ digest: digest("3"), repository: ALPINE },
			{ digest: digest("9"), repository: ALPINE },
			{ digest: digest("5"), repository: NGINX },
		]);
		expect(plan.pins).toEqual([
			{ digest: digest("7"), repository: ALPINE, tag: keepTagFor(digest("7")) },
		]);
		expect(plan.emptiedRepositories).toEqual([NGINX, "ghcr.io/empty"]);
		expect(plan.keptManifests).toBe(3);
	});

	test("an empty keep set deletes everything", () => {
		const plan = planMirrorGc(
			[{ digest: digest("1"), repository: ALPINE, tag: "3.20" }],
			[ALPINE],
			{ digests: [], tags: [] },
		);
		expect(plan.deletes).toHaveLength(1);
		expect(plan.pins).toEqual([]);
		expect(plan.emptiedRepositories).toEqual([ALPINE]);
	});

	test("keep tags are valid registry tags", () => {
		const tag = keepTagFor(digest("f"));
		expect(tag.startsWith(KEEP_TAG_PREFIX)).toBe(true);
		expect(tag).toMatch(/^[\w][\w.-]{0,127}$/);
	});
});

describe("registry helpers", () => {
	test("parses du output and catalog links", () => {
		expect(parseDuKilobytes("24676\t/var/lib/registry\n")).toBe(24_676 * 1024);
		expect(parseDuKilobytes("")).toBeNull();
		expect(nextCatalogPath('</v2/_catalog?last=b&n=1000>; rel="next"')).toBe(
			"/v2/_catalog?last=b&n=1000",
		);
		expect(nextCatalogPath(null)).toBeNull();
		expect(isValidRepository(ALPINE)).toBe(true);
		expect(isValidRepository("../etc")).toBe(false);
		expect(isValidRepository("a/../../b")).toBe(false);
	});
});

interface Call {
	body?: unknown;
	headers: Headers;
	method: string;
	url: string;
}

function fakeRegistry(routes: Record<string, (call: Call) => Response>): {
	calls: Call[];
	client: MirrorRegistryClient;
} {
	const calls: Call[] = [];
	const client = new MirrorRegistryClient(
		"http://mirror:5000/",
		async (url, init) => {
			const call: Call = {
				body: init?.body,
				headers: new Headers(init?.headers),
				method: init?.method ?? "GET",
				url,
			};
			calls.push(call);
			const handler =
				routes[`${call.method} ${url.replace("http://mirror:5000", "")}`];
			return handler ? handler(call) : new Response("nope", { status: 404 });
		},
	);
	return { calls, client };
}

describe("MirrorRegistryClient", () => {
	test("pages the catalog and filters invalid names", async () => {
		const { client } = fakeRegistry({
			"GET /v2/_catalog?n=1000": () =>
				Response.json(
					{ repositories: [ALPINE, "Bad/../name"] },
					{ headers: { Link: '</v2/_catalog?last=x&n=1000>; rel="next"' } },
				),
			"GET /v2/_catalog?last=x&n=1000": () =>
				Response.json({ repositories: [NGINX] }),
		});
		expect(await client.catalog()).toEqual([ALPINE, NGINX]);
	});

	test("resolves tag digests with manifest-list aware Accept headers", async () => {
		const { calls, client } = fakeRegistry({
			[`GET /v2/${ALPINE}/tags/list`]: () =>
				Response.json({ name: ALPINE, tags: ["3.20", "vanished"] }),
			[`HEAD /v2/${ALPINE}/manifests/3.20`]: () =>
				new Response(null, {
					headers: { "Docker-Content-Digest": digest("1") },
				}),
		});
		expect(await client.inventory(ALPINE)).toEqual([
			{ digest: digest("1"), repository: ALPINE, tag: "3.20" },
		]);
		const head = calls.find((call) => call.method === "HEAD");
		expect(head?.headers.get("accept")).toBe(MANIFEST_ACCEPT);
		expect(MANIFEST_ACCEPT).toContain(
			"application/vnd.oci.image.index.v1+json",
		);
		expect(MANIFEST_ACCEPT).toContain(
			"application/vnd.docker.distribution.manifest.list.v2+json",
		);
	});

	test("an unknown repository has no tags", async () => {
		const { client } = fakeRegistry({});
		expect(await client.tags("docker.io/library/gone")).toEqual([]);
	});

	test("deletes by digest, tolerating an already-gone manifest", async () => {
		const { calls, client } = fakeRegistry({
			[`DELETE /v2/${ALPINE}/manifests/${digest("1")}`]: () =>
				new Response(null, { status: 202 }),
		});
		expect(
			await client.deleteManifest({ digest: digest("1"), repository: ALPINE }),
		).toBe(true);
		expect(
			await client.deleteManifest({ digest: digest("2"), repository: ALPINE }),
		).toBe(false);
		expect(calls.map((call) => call.method)).toEqual(["DELETE", "DELETE"]);
	});

	test("surfaces a disabled-delete registry as an error", async () => {
		const { client } = fakeRegistry({
			[`DELETE /v2/${ALPINE}/manifests/${digest("1")}`]: () =>
				Response.json({ errors: [{ code: "UNSUPPORTED" }] }, { status: 405 }),
		});
		await expect(
			client.deleteManifest({ digest: digest("1"), repository: ALPINE }),
		).rejects.toThrow("HTTP 405");
	});

	test("pins a digest by re-putting its manifest under a tag", async () => {
		const manifest = JSON.stringify({ schemaVersion: 2 });
		const type = "application/vnd.oci.image.manifest.v1+json";
		const { calls, client } = fakeRegistry({
			[`GET /v2/${ALPINE}/manifests/${digest("7")}`]: () =>
				new Response(manifest, { headers: { "Content-Type": type } }),
			[`PUT /v2/${ALPINE}/manifests/${keepTagFor(digest("7"))}`]: () =>
				new Response(null, { status: 201 }),
		});
		expect(
			await client.tagManifest({
				digest: digest("7"),
				repository: ALPINE,
				tag: keepTagFor(digest("7")),
			}),
		).toBe(true);
		const put = calls.find((call) => call.method === "PUT");
		expect(put?.headers.get("content-type")).toBe(type);
		expect(new TextDecoder().decode(put?.body as ArrayBuffer)).toBe(manifest);
		expect(
			await client.tagManifest({
				digest: digest("8"),
				repository: ALPINE,
				tag: keepTagFor(digest("8")),
			}),
		).toBe(false);
	});

	test("ping reports an unreachable registry as false", async () => {
		const client = new MirrorRegistryClient("http://mirror:5000", () =>
			Promise.reject(new Error("ECONNREFUSED")),
		);
		expect(await client.ping()).toBe(false);
	});

	test("sends Basic credentials when the registry has auth on", async () => {
		const seen: (string | null)[] = [];
		const client = new MirrorRegistryClient(
			"http://mirror:5000",
			(_url, init) => {
				seen.push(new Headers(init?.headers).get("Authorization"));
				return Promise.resolve(new Response("{}"));
			},
			{ password: "secret", username: "homerun-internal" },
		);
		expect(await client.ping()).toBe(true);
		expect(seen).toEqual([`Basic ${btoa("homerun-internal:secret")}`]);
	});
});
