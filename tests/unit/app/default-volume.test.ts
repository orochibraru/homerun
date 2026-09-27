import { afterEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { ServiceVolumeDTO } = await import(
	"../../../src/lib/dto/service-volume-dto"
);
const { StorageVolumeDTO } = await import(
	"../../../src/lib/dto/storage-volume-dto"
);
const { attachDefaultDataVolume, attachTemplateVolumes } = await import(
	"../../../src/lib/services/default-volume"
);

afterEach(() => restoreStubs());

function record(existingMounts: number) {
	const created: unknown[] = [];
	const attached: unknown[] = [];
	stub(
		ServiceVolumeDTO,
		"listForService",
		async () => Array.from({ length: existingMounts }) as never,
	);
	stub(StorageVolumeDTO, "create", async (input: unknown) => {
		created.push(input);
		return { id: "vol-1" } as never;
	});
	stub(ServiceVolumeDTO, "attach", async (input: unknown) => {
		attached.push(input);
		return {} as never;
	});
	return { attached, created };
}

describe("attachDefaultDataVolume", () => {
	test("a new database gets a named volume at its data directory", async () => {
		const { attached, created } = record(0);
		await attachDefaultDataVolume(
			{ id: "svc-1", image: "postgres", slug: "vortex-db", tag: "18" },
			"user-1",
		);
		expect(created).toEqual([
			{
				description: "Created with vortex-db",
				kind: "volume",
				name: "vortex-db-data",
				source: "vortex-db-data",
				userId: "user-1",
			},
		]);
		expect(attached).toEqual([
			{
				containerPath: "/var/lib/postgresql",
				readOnly: false,
				serviceId: "svc-1",
				volumeId: "vol-1",
			},
		]);
	});

	test("an app, or a database that already has a mount, is left alone", async () => {
		const { created } = record(1);
		await attachDefaultDataVolume(
			{ id: "a", image: "ghcr.io/x/app", slug: "app", tag: "1" },
			"user-1",
		);
		await attachDefaultDataVolume(
			{ id: "b", image: "redis", slug: "cache", tag: "8" },
			"user-1",
		);
		expect(created).toEqual([]);
	});
});

describe("attachTemplateVolumes", () => {
	test("each declared path gets its own volume, named like the wizard's", async () => {
		const { attached, created } = record(0);
		await attachTemplateVolumes(
			{ id: "svc-1", slug: "npm" },
			["/data", "/etc/letsencrypt"],
			"user-1",
		);
		expect(created.map((v) => (v as { name: string }).name)).toEqual([
			"npm-data",
			"npm-data-1",
		]);
		expect(
			attached.map((m) => (m as { containerPath: string }).containerPath),
		).toEqual(["/data", "/etc/letsencrypt"]);
	});

	test("a template with no declared paths gets nothing", async () => {
		const { created } = record(0);
		await attachTemplateVolumes({ id: "svc-1", slug: "app" }, [], "user-1");
		expect(created).toEqual([]);
	});
});
