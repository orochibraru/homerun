import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { nativeFetch } from "./support/config";
import { apiClient, integrationContext } from "./support/context";

let client: ApiClient;
let cleanup: ServiceCleanup;

beforeAll(() => {
	client = apiClient();
	cleanup = new ServiceCleanup(client);
});

afterAll(async () => {
	await cleanup.cleanupAll();
});

const MAP = JSON.stringify({
	mappings: "AAAA",
	names: [],
	sources: ["src/app.ts"],
	sourcesContent: ["console.log(1);"],
	version: 3,
});

describe("source maps", () => {
	test("upload, list, replace and delete a release's maps, refusing anything that isn't one", async () => {
		const created = await client.POST("/services", {
			body: {
				authRequired: false,
				autoDeployOnPush: false,
				buildSource: "image",
				capAdd: [],
				containerPort: 80,
				devices: [],
				dnsResolvable: false,
				envFiles: [],
				envVars: {},
				gitBuildMethod: "dockerfile",
				image: "nginx",
				labels: {},
				name: "sourcemaps",
				privileged: false,
				pullPolicy: "always",
				restartPolicy: "no",
				slug: `it-sourcemaps-${Date.now().toString(36)}`,
				tag: "alpine",
			},
		});
		const svc = expectOk(created.data, created.response);
		cleanup.track(svc.id);

		const { apiKey, origin } = integrationContext();
		const url = `${origin}/api/v1/services/${svc.id}/sourcemaps`;
		const headers = { "x-api-key": apiKey };
		const upload = (release: string, files: Record<string, string>) => {
			const boundary = "homerun-it-boundary";
			const parts = [
				`--${boundary}\r\nContent-Disposition: form-data; name="release"\r\n\r\n${release}\r\n`,
				...Object.entries(files).map(
					([path, content]) =>
						`--${boundary}\r\nContent-Disposition: form-data; name="${path}"; filename="${path.split("/").at(-1)}"\r\nContent-Type: application/json\r\n\r\n${content}\r\n`,
				),
				`--${boundary}--\r\n`,
			];
			return nativeFetch(url, {
				body: parts.join(""),
				headers: {
					...headers,
					"content-type": `multipart/form-data; boundary=${boundary}`,
				},
				method: "POST",
			});
		};

		const first = await upload("abc123", {
			"_app/entry.js.map": MAP,
			"_app/vendor.js.map": MAP,
		});
		expect(first.status).toBe(201);
		const firstBody = await first.json();
		expect(firstBody).toEqual({
			files: ["_app/entry.js", "_app/vendor.js"],
			release: "abc123",
		});
		expect((await upload("abc123", { "_app/entry.js.map": MAP })).status).toBe(
			201,
		);

		const listed = (await (await nativeFetch(url, { headers })).json()) as {
			files: number;
			release: string;
		}[];
		expect(listed).toEqual([
			expect.objectContaining({ files: 2, release: "abc123" }),
		]);

		const bad = await upload("abc123", { "_app/x.js.map": "nope" });
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as { error: string }).error).toContain(
			"version 3",
		);

		const deleted = await nativeFetch(`${url}?release=abc123`, {
			headers,
			method: "DELETE",
		});
		expect(await deleted.json()).toEqual({ deleted: 2, release: "abc123" });
		expect(await (await nativeFetch(url, { headers })).json()).toEqual([]);
	});
});
