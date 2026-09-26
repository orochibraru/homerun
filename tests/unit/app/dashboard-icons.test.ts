import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const {
	DASHBOARD_ICONS_CDN,
	DashboardIconsServiceClass,
	MAX_DASHBOARD_ICON_BYTES,
	parseDashboardIconsMetadata,
} = await import("../../../src/lib/services/dashboard-icons.service");

const METADATA = {
	"Bad Name": { aliases: [], base: "svg", categories: [] },
	dagster: {
		aliases: [],
		base: "svg",
		categories: ["Development"],
		colors: { dark: "dagster-dark", light: "dagster-light" },
	},
	redis: {
		aliases: ["In-Memory Database"],
		base: "svg",
		categories: ["Databases", "databases", "Developer-Tools"],
	},
	webpy: { aliases: [], base: "webp", categories: [] },
	wiki: { aliases: "nope", base: "png", categories: null },
};

const svg = new Uint8Array(new TextEncoder().encode("<svg/>"));
const dirs: string[] = [];

function setup(files: Record<string, Uint8Array<ArrayBuffer> | null> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "dashboard-icons-"));
	dirs.push(dir);
	const calls: string[] = [];
	let clock = 1_000;
	let metadataStatus = 200;
	const service = new DashboardIconsServiceClass({
		dir: () => dir,
		fetch: async (url) => {
			calls.push(url.slice(DASHBOARD_ICONS_CDN.length));
			if (url.endsWith("/metadata.json")) {
				return new Response(JSON.stringify(METADATA), {
					status: metadataStatus,
				});
			}
			const body = files[url.slice(DASHBOARD_ICONS_CDN.length)];
			return body
				? new Response(body, { status: 200 })
				: new Response("nope", { status: 404 });
		},
		now: () => clock,
	});
	return {
		advance: (ms: number) => {
			clock += ms;
		},
		calls,
		dir,
		failMetadata: () => {
			metadataStatus = 500;
		},
		service,
	};
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe("parseDashboardIconsMetadata", () => {
	test("keeps valid svg/png slugs, lowercases categories, keeps colour variants", () => {
		expect(parseDashboardIconsMetadata(METADATA)).toEqual([
			{
				aliases: [],
				categories: ["development"],
				format: "svg",
				name: "dagster",
				variants: ["dagster-dark", "dagster-light"],
			},
			{
				aliases: ["In-Memory Database"],
				categories: ["databases", "developer-tools"],
				format: "svg",
				name: "redis",
				variants: [],
			},
			{
				aliases: [],
				categories: [],
				format: "png",
				name: "wiki",
				variants: [],
			},
		]);
	});

	test("refuses something that isn't an object", () => {
		expect(() => parseDashboardIconsMetadata(null)).toThrow();
	});
});

describe("DashboardIconsService.catalog", () => {
	test("fetches once, trims entries and saves a disk copy", async () => {
		const { calls, dir, service } = setup();
		const catalog = await service.catalog();
		expect(catalog.map((icon) => icon.name)).toEqual([
			"dagster",
			"redis",
			"wiki",
		]);
		expect(catalog[1]).toEqual({
			aliases: ["In-Memory Database"],
			categories: ["databases", "developer-tools"],
			name: "redis",
		});
		await service.catalog();
		expect(calls).toEqual(["/metadata.json"]);
		expect(existsSync(join(dir, "catalog.json"))).toBe(true);
	});

	test("serves a stale copy while it refreshes, and the disk copy when offline", async () => {
		const first = setup();
		await first.service.catalog();
		first.advance(25 * 60 * 60 * 1000);
		first.failMetadata();
		expect((await first.service.catalog()).length).toBe(3);
		expect(first.calls).toEqual(["/metadata.json", "/metadata.json"]);

		const offline = new DashboardIconsServiceClass({
			dir: () => first.dir,
			fetch: () => Promise.reject(new Error("offline")),
			now: () => 2_000,
		});
		expect((await offline.catalog()).length).toBe(3);
	});

	test("throws with no copy anywhere and upstream down", async () => {
		const { failMetadata, service } = setup();
		failMetadata();
		await expect(service.catalog()).rejects.toThrow("500");
	});

	test("ignores an unreadable disk copy", async () => {
		const { dir, service } = setup();
		writeFileSync(join(dir, "catalog.json"), "{not json");
		expect((await service.catalog()).length).toBe(3);
	});
});

describe("DashboardIconsService.icon", () => {
	test("downloads once, caches on disk, then serves from disk", async () => {
		const { calls, dir, service } = setup({ "/svg/redis.svg": svg });
		const icon = await service.icon("redis");
		expect(icon?.contentType).toBe("image/svg+xml");
		expect(new TextDecoder().decode(icon?.body)).toBe("<svg/>");
		expect(readFileSync(join(dir, "icons", "redis.svg"), "utf8")).toBe(
			"<svg/>",
		);
		await service.icon("redis");
		expect(calls).toEqual(["/metadata.json", "/svg/redis.svg"]);
	});

	test("falls back to a colour variant when the plain name is missing", async () => {
		const { service } = setup({ "/svg/dagster-dark.svg": svg });
		expect((await service.icon("dagster"))?.contentType).toBe("image/svg+xml");
	});

	test("serves png icons as png", async () => {
		const { service } = setup({ "/png/wiki.png": new Uint8Array([1, 2]) });
		expect((await service.icon("wiki"))?.contentType).toBe("image/png");
	});

	test("refuses invalid and unknown names without fetching them", async () => {
		const { calls, service } = setup();
		expect(await service.icon("../etc/passwd")).toBeNull();
		expect(await service.icon("not-in-catalog")).toBeNull();
		expect(calls).toEqual(["/metadata.json"]);
	});

	test("remembers a missing icon for ten minutes", async () => {
		const { advance, calls, service } = setup();
		expect(await service.icon("redis")).toBeNull();
		expect(await service.icon("redis")).toBeNull();
		expect(calls.filter((c) => c.includes("redis"))).toHaveLength(1);
		advance(11 * 60 * 1000);
		await service.icon("redis");
		expect(calls.filter((c) => c.includes("redis"))).toHaveLength(2);
	});

	test("refuses an oversized icon", async () => {
		const { service } = setup({
			"/svg/redis.svg": new Uint8Array(MAX_DASHBOARD_ICON_BYTES + 1),
		});
		expect(await service.icon("redis")).toBeNull();
	});

	test("tries both formats when the catalog can't be loaded", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dashboard-icons-"));
		dirs.push(dir);
		const calls: string[] = [];
		const service = new DashboardIconsServiceClass({
			dir: () => dir,
			fetch: async (url) => {
				calls.push(url.slice(DASHBOARD_ICONS_CDN.length));
				if (url.endsWith("/png/anything.png")) {
					return new Response(new Uint8Array([1]));
				}
				return new Response("down", { status: 503 });
			},
			now: () => 0,
		});
		expect((await service.icon("anything"))?.contentType).toBe("image/png");
		expect(calls).toEqual([
			"/metadata.json",
			"/svg/anything.svg",
			"/png/anything.png",
		]);
	});
});
