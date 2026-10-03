import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { Logger } = await import("../../../src/lib/logger");
const { DeploymentDTO } = await import("../../../src/lib/dto/deployment-dto");
const { DeploymentService } = await import(
	"../../../src/lib/services/deploy.service"
);
const { QueueService } = await import(
	"../../../src/lib/services/queue.service"
);
const { PreviewApiService } = await import(
	"../../../src/lib/services/preview-api.service"
);
const { PreviewService } = await import(
	"../../../src/lib/services/preview.service"
);
const { RevisionService } = await import(
	"../../../src/lib/services/revision.service"
);
const { ServiceGitDTO } = await import("../../../src/lib/dto/service-git-dto");
const { StackDTO } = await import("../../../src/lib/dto/stack-dto");

type Parent = Parameters<typeof PreviewApiService.promote>[0]["parent"];

const parent = {
	buildSource: "git",
	id: "parent",
	name: "Web",
	stackId: "stk",
	toJSON: () => ({ previewParentId: null }),
	update: async () => undefined,
} as unknown as Parent;

const previewRow = {
	defaultDomainEnabled: true,
	dnsResolvable: true,
	domains: [],
	previewBranch: "feature",
	previewPrNumber: 7,
	previewPrTitle: "Add thing",
	primaryDomain: null,
	slug: "web-pr-7",
};

const preview = {
	...previewRow,
	currentStatus: "running",
	gitRef: "feature",
	id: "preview",
	name: "Web #7",
	toJSON: () => previewRow,
};

let created: Record<string, unknown>[] = [];
let queued: Record<string, unknown>[] = [];
let health: string | null = "healthy";
let hasPreview = true;
let hasRevision = true;

beforeEach(() => {
	created = [];
	queued = [];
	health = "healthy";
	hasPreview = true;
	hasRevision = true;
	stub(Logger.prototype, "info", () => undefined);
	stub(ServiceGitDTO, "getPreview", async () => (hasPreview ? preview : null));
	stub(ServiceGitDTO, "listPreviews", async () => [preview]);
	stub(StackDTO, "get", async () => ({ slug: "stk" }));
	stub(RevisionService, "list", async () =>
		hasRevision
			? [
					{
						current: true,
						gitCommit: "abc1234def",
						gitRef: "feature",
						health,
						healthReason: null,
						id: "d-preview",
						imageDigest: null,
						imageRef: "web-pr-7:abc",
						lastDeployedAt: null,
					},
				]
			: [],
	);
	stub(DeploymentDTO, "listForService", async () => [
		{
			toJSON: () => ({
				createdAt: new Date(0),
				errorMessage: null,
				finishedAt: null,
				gitCommit: "abc1234def",
				gitRef: "feature",
				id: "d-preview",
				status: "running",
			}),
		},
	]);
	stub(DeploymentDTO, "create", async (input: Record<string, unknown>) => {
		created.push(input);
		return { id: "d-new" };
	});
	stub(QueueService, "enqueue", async (input: Record<string, unknown>) => {
		queued.push(input);
		return { id: "job-1", payload: input.payload };
	});
});

afterEach(restoreStubs);

describe("PreviewApiService.promote", () => {
	test("queues a promote deploy of the preview revision's image, not a rollback", async () => {
		const result = await PreviewApiService.promote({
			commit: "abc1234",
			parent,
			prNumber: 7,
			userId: "u1",
		});

		expect(result.error).toBeNull();
		expect(created[0]).toMatchObject({
			restoreConfig: false,
			rollbackOfDeploymentId: "d-preview",
			trigger: "promote",
		});
		expect(queued[0]).toMatchObject({
			dedupeKey: "promote:parent",
			payload: { trigger: "promote" },
			title: "Promote to Web",
		});
	});

	test("refuses what it can't promote without queueing anything", async () => {
		const promote = (commit: string | null = null, target = parent) =>
			PreviewApiService.promote({
				commit,
				parent: target,
				prNumber: 7,
				userId: "u1",
			});
		const imageParent = {
			buildSource: "image",
			id: "parent",
			toJSON: () => ({ previewParentId: null }),
		} as unknown as Parent;
		expect(await promote(null, imageParent)).toMatchObject({ status: 400 });
		expect(await promote("fff")).toMatchObject({ status: 409 });
		health = "watching";
		expect(await promote()).toMatchObject({ status: 409 });
		hasRevision = false;
		expect(await promote()).toMatchObject({ status: 409 });
		hasPreview = false;
		expect(await promote()).toMatchObject({ status: 404 });
		expect(queued).toHaveLength(0);
	});
});

describe("PreviewApiService views", () => {
	test("lists previews with their current revision and latest attempt", async () => {
		const [view] = await PreviewApiService.list(parent);
		expect(view).toMatchObject({
			deployment: { id: "d-preview", status: "running" },
			prNumber: 7,
			revision: { id: "d-preview", imageRef: "web-pr-7:abc" },
			slug: "web-pr-7",
		});
		expect(view.hostnames.length).toBeGreaterThan(0);
	});

	test("deletes a preview through PreviewService, false when there's none", async () => {
		const removed: string[] = [];
		stub(PreviewService, "delete", async (_parent: unknown, id: string) => {
			removed.push(id);
		});
		expect(await PreviewApiService.delete(parent, 7)).toBe(true);
		hasPreview = false;
		expect(await PreviewApiService.delete(parent, 7)).toBe(false);
		expect(await PreviewApiService.get(parent, 7)).toBeNull();
		expect(removed).toEqual(["preview"]);
	});
});

describe("DeploymentService.enqueueDeploy", () => {
	test("a rollback keeps its own dedupe key and title", async () => {
		await DeploymentService.enqueueDeploy({
			restoreConfig: true,
			rollbackOfDeploymentId: "d-old",
			svc: parent,
			userId: "u1",
		});
		expect(created[0]).toMatchObject({
			restoreConfig: true,
			trigger: "manual",
		});
		expect(queued[0]).toMatchObject({
			dedupeKey: "rollback:parent",
			title: "Roll back Web",
		});
	});
});
