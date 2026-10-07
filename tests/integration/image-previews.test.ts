import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectOk } from "./support/assert";
import { ServiceCleanup } from "./support/cleanup";
import type { ApiClient } from "./support/client";
import { apiClient, integrationContext } from "./support/context";

const FIRST_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SECOND_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";

let client: ApiClient;
let cleanup: ServiceCleanup;

/** Creates an image-based nginx service with previews on or off. */
async function imageService(name: string, previewsEnabled: boolean) {
	const suffix = Date.now().toString(36);
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
			envVars: { ORIGIN: "http://parent" },
			gitBuildMethod: "dockerfile",
			image: "nginx",
			labels: {},
			name: `${name} ${suffix}`,
			privileged: false,
			pullPolicy: "missing",
			restartPolicy: "no",
			slug: `it-${name}-${suffix}`,
			tag: "alpine",
		},
	});
	const service = expectOk(created.data, created.response);
	cleanup.track(service.id);
	const patched = await client.PATCH("/services/{serviceId}", {
		body: {
			previewBranchExclude: ["chore/*"],
			previewEnvOverrides: { PREVIEW: "pr-{pr}" },
			previewsEnabled,
		},
		params: { path: { serviceId: service.id } },
	});
	expectOk(patched.data, patched.response);
	return service;
}

/** Polls the preview of #7 until its current revision records `commit`, failing on a failed deploy. */
async function waitForRevision(serviceId: string, commit: string) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		// oxlint-disable-next-line no-await-in-loop -- polling one preview until its deploy lands
		const { data } = await client.GET(
			"/services/{serviceId}/previews/{prNumber}",
			{ params: { path: { prNumber: "7", serviceId } } },
		);
		if (data?.deployment?.status === "failed") {
			throw new Error(`Preview deploy failed: ${data.deployment.errorMessage}`);
		}
		if (data?.revision?.gitCommit === commit) {
			return data;
		}
		// oxlint-disable-next-line no-await-in-loop -- see above
		await Bun.sleep(1000);
	}
	throw new Error(`The preview never ran ${commit}.`);
}

beforeAll(() => {
	client = apiClient();
	cleanup = new ServiceCleanup(client);
});

afterAll(async () => {
	await cleanup.cleanupAll();
});

describe("image-based pull request previews", () => {
	test("CI creates, updates and deletes a preview through PUT and DELETE", async () => {
		const parent = await imageService("image-preview", true);
		const path = { prNumber: "7", serviceId: parent.id };

		const created = await client.PUT(
			"/services/{serviceId}/previews/{prNumber}",
			{
				body: {
					branch: "feat/login",
					commit: FIRST_COMMIT,
					tag: "alpine",
					title: "Add login",
				},
				params: { path },
			},
		);
		const first = expectOk(created.data, created.response);
		expect(created.response.status).toBe(202);
		expect(first).toMatchObject({
			branch: "feat/login",
			gitRef: null,
			prNumber: 7,
			title: "Add login",
		});
		expect(first.deploymentId).toBeTruthy();
		const running = await waitForRevision(parent.id, FIRST_COMMIT);
		expect(running.revision?.imageRef).toContain("nginx:alpine");

		const preview = await client.GET("/services/{serviceId}", {
			params: { path: { serviceId: first.id } },
		});
		expect(expectOk(preview.data, preview.response)).toMatchObject({
			buildSource: "image",
			envVars: { ORIGIN: "http://parent", PREVIEW: "pr-7" },
			image: "nginx",
			tag: "alpine",
		});

		const updated = await client.PUT(
			"/services/{serviceId}/previews/{prNumber}",
			{
				body: { commit: SECOND_COMMIT, tag: "stable-alpine" },
				params: { path },
			},
		);
		const second = expectOk(updated.data, updated.response);
		expect(second.id).toBe(first.id);
		expect(second.title).toBe("Add login");
		const redeployed = await waitForRevision(parent.id, SECOND_COMMIT);
		expect(redeployed.revision?.imageRef).toContain("nginx:stable-alpine");

		const removed = await client.DELETE(
			"/services/{serviceId}/previews/{prNumber}",
			{ params: { path } },
		);
		expectOk(removed.data, removed.response);
		const gone = await client.GET("/services/{serviceId}/previews/{prNumber}", {
			params: { path },
		});
		expect(gone.response.status).toBe(404);
	}, 240_000);

	test("refuses a filtered branch, previews off and a git service", async () => {
		const ctx = integrationContext();
		const parent = await imageService("image-preview-refused", true);
		const filtered = await client.PUT(
			"/services/{serviceId}/previews/{prNumber}",
			{
				body: { branch: "chore/deps", tag: "alpine" },
				params: { path: { prNumber: "7", serviceId: parent.id } },
			},
		);
		expect(filtered.response.status).toBe(409);
		const none = await client.GET("/services/{serviceId}/previews", {
			params: { path: { serviceId: parent.id } },
		});
		expect(expectOk(none.data, none.response)).toEqual([]);

		const off = await imageService("image-preview-off", false);
		const refusedOff = await client.PUT(
			"/services/{serviceId}/previews/{prNumber}",
			{
				body: { tag: "alpine" },
				params: { path: { prNumber: "7", serviceId: off.id } },
			},
		);
		expect(refusedOff.response.status).toBe(409);

		const git = await client.POST("/services", {
			body: {
				authRequired: false,
				autoDeployOnPush: false,
				buildSource: "git",
				capAdd: [],
				containerPort: 80,
				devices: [],
				dnsResolvable: false,
				envFiles: [],
				envVars: {},
				gitBuildMethod: "dockerfile",
				gitRef: "main",
				gitUrl: ctx.gitBuildFixtureUrl,
				labels: {},
				name: "IT git preview refused",
				privileged: false,
				pullPolicy: "always",
				restartPolicy: "no",
				slug: `it-git-preview-${Date.now().toString(36)}`,
			},
		});
		const gitService = expectOk(git.data, git.response);
		cleanup.track(gitService.id);
		const refusedGit = await client.PUT(
			"/services/{serviceId}/previews/{prNumber}",
			{
				body: { tag: "alpine" },
				params: { path: { prNumber: "7", serviceId: gitService.id } },
			},
		);
		expect(refusedGit.response.status).toBe(400);
	});
});
