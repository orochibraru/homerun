import { describe, expect, test } from "bun:test";
import { splitImageRef } from "../../../src/lib/image-ref";
import { mirrorRepository } from "../../../src/lib/services/docker/image-scan-refs";
import {
	isValidRepository,
	MANIFEST_ACCEPT,
	MirrorRegistryClient,
	mirrorKeepSet,
	nextCatalogPath,
	parseDuKilobytes,
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
