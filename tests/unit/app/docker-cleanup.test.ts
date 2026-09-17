import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { DockerCleanupMixin, prunableVolumes } = await import(
	"../../../src/lib/services/docker/cleanup"
);

const VOLUMES = [
	{ Driver: "local", Name: "in-use", UsageData: { RefCount: 1, Size: 10 } },
	{ Driver: "local", Name: "orphan", UsageData: { RefCount: 0, Size: 20 } },
	{
		Driver: "local",
		Name: "homerun-vol-db",
		UsageData: { RefCount: 0, Size: 30 },
	},
	{ Driver: "local", Name: "unknown-usage", UsageData: null },
];

function fakeCleanupService() {
	const removed: string[] = [];
	let daemonPruneCalls = 0;
	const docker = {
		df: async () => ({ Volumes: VOLUMES }),
		getVolume: (name: string) => ({
			remove: async () => {
				removed.push(name);
			},
		}),
		listNetworks: async () => [],
		pruneVolumes: async () => {
			daemonPruneCalls += 1;
			return { SpaceReclaimed: 0, VolumesDeleted: [] };
		},
	};
	class FakeBase {
		getDocker() {
			return docker;
		}
	}
	const Service = DockerCleanupMixin(
		FakeBase as unknown as Parameters<typeof DockerCleanupMixin>[0],
	);
	return {
		daemonPruneCalls: () => daemonPruneCalls,
		removed,
		service: new Service(),
	};
}

describe("prunableVolumes", () => {
	test("keeps referenced volumes and every kept name", () => {
		const names = prunableVolumes(VOLUMES, new Set(["homerun-vol-db"])).map(
			(volume) => volume.Name,
		);
		expect(names).toEqual(["orphan", "unknown-usage"]);
	});
});

describe("DockerCleanupMixin volumes", () => {
	test("never prunes a volume a Homerun service mounts", async () => {
		const fake = fakeCleanupService();
		const summary = await fake.service.pruneVolumes(["homerun-vol-db"]);
		expect(fake.removed).toEqual(["orphan", "unknown-usage"]);
		expect(fake.daemonPruneCalls()).toBe(0);
		expect(summary).toEqual({ itemsDeleted: 2, spaceReclaimedBytes: 20 });
	});

	test("falls back to the daemon's own prune with nothing to keep", async () => {
		const fake = fakeCleanupService();
		await fake.service.pruneVolumes();
		expect(fake.daemonPruneCalls()).toBe(1);
		expect(fake.removed).toEqual([]);
	});

	test("hides mounted volumes from the preview", async () => {
		const fake = fakeCleanupService();
		const preview = await fake.service.getCleanupPreview(
			[],
			["homerun-vol-db"],
		);
		expect(preview.volumes.items.map((item) => item.id)).toEqual([
			"orphan",
			"unknown-usage",
		]);
	});
});
