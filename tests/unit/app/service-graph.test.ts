import { describe, expect, test } from "bun:test";
import {
	createsCycle,
	dependencyForest,
	dependencyLayers,
	dependencyMap,
	linkKeys,
	mergeDependencies,
	previewsByParent,
	referencesHost,
	toPreviewRow,
} from "../../../src/lib/service-graph";
import {
	ancestorIds,
	descendantIds,
	flattenStackTree,
	stackPath,
	wouldCycle,
} from "../../../src/lib/stack-tree";

const vortex: {
	envVars: Record<string, string>;
	id: string;
	slug: string;
}[] = [
	{
		envVars: {
			REDIS_URL: "redis://:pw@vortex-redis:6379",
			STREMTHRU_URL: "http://stremthru:8080",
		},
		id: "server",
		slug: "vortex-server",
	},
	{
		envVars: {
			REDIS_URL: "redis://:pw@vortex-redis:6379",
			VORTEX_URL: "http://vortex-server:7080",
		},
		id: "worker",
		slug: "vortex-worker",
	},
	{ envVars: {}, id: "redis", slug: "vortex-redis" },
	{ envVars: {}, id: "stremthru", slug: "stremthru" },
	{ envVars: { X: "https://redis.io" }, id: "bare", slug: "redis" },
];

describe("service dependencies", () => {
	test("a slug counts only as a whole hostname", () => {
		expect(
			referencesHost("redis://:pw@vortex-redis:6379", "vortex-redis"),
		).toBe(true);
		expect(referencesHost("vortex-redis:6379", "vortex-redis")).toBe(true);
		expect(referencesHost("http://vortex-server", "vortex-server")).toBe(true);
		expect(referencesHost("redis://:pw@vortex-redis:6379", "redis")).toBe(
			false,
		);
		expect(referencesHost("https://redis.io", "redis")).toBe(false);
	});

	test("prefixed keys like StremThru's still link to the right hosts only", () => {
		const deps = dependencyMap([
			{
				envVars: {
					STREMTHRU_DATABASE_URI:
						"postgresql://stremthru:pw@stremthru-db:5432/stremthru?sslmode=disable",
					STREMTHRU_REDIS_URI: "redis://:pw@stremthru-cache:6379",
				},
				id: "app",
				slug: "stremthru",
			},
			{
				envVars: { POSTGRES_DB: "stremthru", POSTGRES_USER: "stremthru" },
				id: "db",
				slug: "stremthru-db",
			},
			{ envVars: {}, id: "cache", slug: "stremthru-cache" },
		]);
		expect(deps.get("app")).toEqual(["db", "cache"]);
		expect(deps.get("db")).toEqual([]);
		expect(
			dependencyForest(["cache", "db", "app"], deps).map((n) => n.id),
		).toEqual(["app"]);
	});

	test("a user, password, database name or path isn't a host", () => {
		const url = "postgres://stremthru:pw@stremthru-db:5432/stremthru";
		expect(referencesHost(url, "stremthru")).toBe(false);
		expect(referencesHost(url, "stremthru-db")).toBe(true);
		expect(referencesHost("stremthru", "stremthru", "POSTGRES_DB")).toBe(false);
		expect(referencesHost("stremthru", "stremthru", "UPSTREAM_HOST")).toBe(
			true,
		);
		expect(
			referencesHost("kafka-1:9092,kafka-2:9092", "kafka-2", "BROKERS"),
		).toBe(true);
	});

	test("edges come from env values pointing at another service's slug", () => {
		const deps = dependencyMap(vortex);
		expect(deps.get("server")).toEqual(["redis", "stremthru"]);
		expect(deps.get("worker")).toEqual(["server", "redis"]);
		expect(deps.get("bare")).toEqual([]);
	});

	test("a stack reads as a tree from what nothing depends on down", () => {
		const deps = dependencyMap(vortex);
		const forest = dependencyForest(["server", "worker", "redis"], deps);
		expect(forest.map((n) => n.id)).toEqual(["worker"]);
		const [worker] = forest;
		expect(worker?.children.map((n) => [n.id, n.repeat])).toEqual([
			["server", false],
			["redis", true],
		]);
		expect(worker?.children[0]?.children.map((n) => [n.id, n.repeat])).toEqual([
			["redis", false],
			["stremthru", false],
		]);
	});

	test("unlinking removes only the vars pointing at that host", () => {
		expect(
			linkKeys(
				{
					CACHE: "redis://:pw@vortex-redis:6379",
					NAME: "vortex-redis-backup",
					QUEUE: "vortex-redis:6379/1",
				},
				"vortex-redis",
			),
		).toEqual(["CACHE", "QUEUE"]);
		expect(linkKeys(null, "x")).toEqual([]);
	});

	test("a dependency outside the members isn't expanded", () => {
		const deps = new Map([
			["stremthru", ["server"]],
			["server", ["redis"]],
		]);
		expect(dependencyForest(["stremthru"], deps)).toEqual([
			{
				children: [{ children: [], id: "server", repeat: false }],
				id: "stremthru",
				repeat: false,
			},
		]);
	});

	test("a cycle neither loops nor loses a member", () => {
		const deps = new Map([
			["a", ["b"]],
			["b", ["a"]],
		]);
		const forest = dependencyForest(["a", "b"], deps);
		expect(forest.map((n) => n.id)).toEqual(["a"]);
		expect(forest[0]?.children[0]?.children[0]).toEqual({
			children: [],
			id: "a",
			repeat: true,
		});
		expect(dependencyLayers(["a", "b"], deps).flat().sort()).toEqual([
			"a",
			"b",
		]);
	});

	test("the diagram puts consumers on top and dependencies below", () => {
		const deps = dependencyMap(vortex);
		expect(
			dependencyLayers(["server", "worker", "redis", "stremthru"], deps),
		).toEqual([["worker"], ["server"], ["redis", "stremthru"]]);
	});
});

describe("nested stacks", () => {
	const stacks = [
		{ id: "media", name: "Media", parentId: null, slug: "media" },
		{ id: "vortex", name: "Vortex", parentId: "media", slug: "vortex" },
		{ id: "cache", name: "Cache", parentId: "vortex", slug: "cache" },
		{ id: "gitea", name: "Gitea", parentId: null, slug: "gitea" },
	];
	const parents = new Map(stacks.map((s) => [s.id, s.parentId]));

	test("ancestors, descendants and the display path", () => {
		expect(ancestorIds("cache", parents)).toEqual(["vortex", "media"]);
		expect(descendantIds("media", stacks)).toEqual(["vortex", "cache"]);
		expect(stackPath("cache", stacks)).toBe("Media / Vortex / Cache");
	});

	test("a stack can't be nested under itself or its own substack", () => {
		expect(wouldCycle("media", "cache", parents)).toBe(true);
		expect(wouldCycle("media", "media", parents)).toBe(true);
		expect(wouldCycle("gitea", "cache", parents)).toBe(false);
	});

	test("the flattened tree lists each parent before its children", () => {
		expect(
			flattenStackTree(stacks).map(({ depth, stack }) => [stack.id, depth]),
		).toEqual([
			["gitea", 0],
			["media", 0],
			["vortex", 1],
			["cache", 2],
		]);
	});
});

describe("recorded dependencies", () => {
	const deps = new Map([
		["app", ["api"]],
		["api", ["db", "cache"]],
		["worker", ["db"]],
	]);

	test("merging keeps every edge once", () => {
		expect(
			mergeDependencies(
				new Map([["app", ["api"]]]),
				new Map([
					["app", ["api", "db"]],
					["db", []],
				]),
			),
		).toEqual(
			new Map([
				["app", ["api", "db"]],
				["db", []],
			]),
		);
	});

	test("a dependency can't point at itself or back up the chain", () => {
		expect(createsCycle("db", "db", deps)).toBe(true);
		expect(createsCycle("db", "app", deps)).toBe(true);
		expect(createsCycle("cache", "api", deps)).toBe(true);
		expect(createsCycle("worker", "api", deps)).toBe(false);
		expect(createsCycle("app", "worker", deps)).toBe(false);
	});

	test("reversed layers start dependencies before what needs them", () => {
		expect(
			dependencyLayers(["app", "worker", "api", "db", "cache"], deps).reverse(),
		).toEqual([["db", "cache"], ["api"], ["app", "worker"]]);
	});

	test("a cycle still yields every service once", () => {
		const looped = new Map([
			["a", ["b"]],
			["b", ["a"]],
		]);
		expect(dependencyLayers(["a", "b"], looped).flat().toSorted()).toEqual([
			"a",
			"b",
		]);
	});
});

describe("previews under their parent", () => {
	const row = (id: string, parent: string, pr: number) =>
		toPreviewRow({
			channelCanary: false,
			currentStatus: "running",
			id,
			name: `Web PR #${pr}`,
			previewBranch: "feat/x",
			previewParentId: parent,
			previewPrNumber: pr,
			previewPrTitle: null,
		});

	test("groups previews by the service they preview, keeping order", () => {
		const grouped = previewsByParent([
			row("p2", "web", 2),
			row("p9", "api", 9),
			row("p1", "web", 1),
		]);
		expect(grouped.get("web")?.map((p) => p.prNumber)).toEqual([2, 1]);
		expect(grouped.get("api")?.map((p) => p.id)).toEqual(["p9"]);
		expect(grouped.get("db")).toBeUndefined();
	});

	test("a release channel canary is flagged as one", () => {
		const canary = toPreviewRow({
			channelCanary: true,
			currentStatus: "running",
			id: "c1",
			name: "Web (canary)",
			previewBranch: null,
			previewParentId: "web",
			previewPrNumber: null,
			previewPrTitle: null,
		});
		expect(canary).toMatchObject({ canary: true, parentId: "web" });
		expect(row("p1", "web", 1).canary).toBe(false);
	});
});
