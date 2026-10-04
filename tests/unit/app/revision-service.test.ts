import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { DeploymentDTO } = await import("../../../src/lib/dto/deployment-dto");
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { DeploymentService } = await import(
	"../../../src/lib/services/deploy.service"
);
const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);
const { RevisionError, RevisionService } = await import(
	"../../../src/lib/services/revision.service"
);

type Row = Record<string, unknown>;

function row(id: string, overrides: Row = {}): Row {
	const at = new Date(
		`2026-09-${String(10 + Number(id.at(-1) ?? 0)).padStart(2, "0")}T10:00:00Z`,
	);
	return {
		buildSource: "image",
		createdAt: at,
		environment: "production",
		errorMessage: null,
		finishedAt: at,
		gitCommit: null,
		gitRef: null,
		hasConfigSnapshot: false,
		health: null,
		healthReason: null,
		id,
		imageDigest: null,
		imageId: `sha256:${id}`,
		imageRef: `nginx:${id}`,
		log: `log ${id}`,
		rollbackOfDeploymentId: null,
		serviceId: "svc",
		startedAt: at,
		status: "running",
		trigger: "manual",
		...overrides,
	};
}

function dto(data: Row) {
	return {
		id: data.id as string,
		rollbackOfDeploymentId:
			(data.rollbackOfDeploymentId as string | null) ?? null,
		toJSON: () => data,
	};
}

type Dto = ReturnType<typeof dto>;
type Svc = Parameters<typeof RevisionService.resolveTarget>[0];

const svc = {
	containerId: "c1",
	id: "svc",
	swarmServiceId: null,
} as unknown as Svc;

let rows: Row[] = [];
let extra: Row[] = [];
let enqueued: unknown[] = [];

beforeEach(() => {
	rows = [];
	extra = [];
	enqueued = [];
	stub(InstanceSettingsDTO, "get", async () => ({
		retainedImagesPerService: 5,
	}));
	stub(DeploymentDTO, "listRevisions", async () => rows.map(dto));
	stub(DeploymentDTO, "listForService", async () => rows.map(dto));
	stub(
		DeploymentDTO,
		"listByIdsForService",
		async (_id: string, ids: string[]) =>
			extra.filter((r) => ids.includes(r.id as string)).map(dto),
	);
	stub(DeploymentDTO, "getForService", async (_id: string, depId: string) => {
		const found = [...rows, ...extra].find((r) => r.id === depId);
		return found ? dto(found) : null;
	});
	stub(DeploymentService, "enqueueDeploy", async (input: unknown) => {
		enqueued.push(input);
		return { deploymentId: "d-new", jobId: "j1" };
	});
});

afterEach(() => restoreStubs());

describe("RevisionService lists", () => {
	test("one entry per revision, current and previous marked", async () => {
		rows = [row("d2"), row("d1")];
		const list = await RevisionService.list(svc);
		expect(list.map((r) => [r.id, r.current, r.previous])).toEqual([
			["d2", true, false],
			["d1", false, true],
		]);
		expect(list[0]).toMatchObject({
			deployable: true,
			imageRef: "nginx:d2",
			log: "log d2",
			retained: true,
		});
	});

	test("a rollback whose target fell outside the window loads it and folds in", async () => {
		rows = [
			row("d3", {
				imageId: "sha256:d1",
				imageRef: "nginx:d1",
				rollbackOfDeploymentId: "d1",
			}),
		];
		extra = [row("d1")];
		const history = await RevisionService.history(svc, 10);
		expect(history.map((r) => [r.id, r.redeployCount])).toEqual([["d1", 1]]);
	});

	test("the pruner keeps the images of retained revisions", async () => {
		stub(DeploymentDTO, "listRetainedRevisions", async () => [row("d1")]);
		stub(DockerService, "existingImageIds", async (refs: string[]) =>
			refs.filter((ref) => ref.startsWith("sha256:")),
		);
		expect(await RevisionService.retainedImageIds()).toEqual(["sha256:d1"]);
	});
});

describe("RevisionService targets", () => {
	test("an explicit redeploy id resolves to the revision it redeployed", async () => {
		rows = [row("d3", { rollbackOfDeploymentId: "d1" }), row("d1")];
		const target = (await RevisionService.resolveTarget(
			svc,
			"d3",
		)) as unknown as Dto;
		expect(target.id).toBe("d1");
	});

	test("an unknown or failed revision is a 404", async () => {
		rows = [row("d1", { imageRef: null, status: "failed" })];
		await expect(
			RevisionService.resolveTarget(svc, "nope"),
		).rejects.toMatchObject({
			status: 404,
		});
		const found = await RevisionService.findTarget(svc, "d1");
		expect(found).toMatchObject({ revision: null, status: 404 });
	});

	test("without an id the previous revision is the target, or a 400 when there is none", async () => {
		rows = [row("d2"), row("d1")];
		const target = (await RevisionService.resolveTarget(
			svc,
			null,
		)) as unknown as Dto;
		expect(target.id).toBe("d1");
		rows = [row("d1")];
		const none = await RevisionService.findTarget(svc, null);
		expect(none).toMatchObject({ revision: null, status: 400 });
		expect(new RevisionError("x", 418).status).toBe(418);
	});

	test("findTarget rethrows anything that isn't a RevisionError", async () => {
		stub(DeploymentDTO, "getForService", async () => {
			throw new Error("db down");
		});
		await expect(RevisionService.findTarget(svc, "d1")).rejects.toThrow(
			"db down",
		);
	});

	test("a rollback is enqueued against the revision's row", async () => {
		const revision = dto(row("d1")) as unknown as Parameters<
			typeof RevisionService.enqueueRollback
		>[0]["revision"];
		await RevisionService.enqueueRollback({ revision, svc, userId: "u1" });
		expect(enqueued).toEqual([
			{ restoreConfig: false, rollbackOfDeploymentId: "d1", svc, userId: "u1" },
		]);
	});
});
