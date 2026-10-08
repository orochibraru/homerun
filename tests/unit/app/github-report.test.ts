import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { Logger } = await import("../../../src/lib/logger");
const { GitConnectionDTO } = await import(
	"../../../src/lib/dto/git-connection-dto"
);
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { GitProviderService } = await import(
	"../../../src/lib/services/git-provider.service"
);
const { PREVIEW_COMMENT_MARKER, GitHubReportService, previewCommentBody } =
	await import("../../../src/lib/services/github-report.service");

type Preview = Parameters<typeof GitHubReportService.deployed>[0];
type Deployment = Parameters<typeof GitHubReportService.deployed>[1];
type Parent = Parameters<typeof GitHubReportService.closed>[0];

interface Call {
	body?: Record<string, unknown>;
	method: string;
	path: string;
}

function row(fields: Record<string, unknown>) {
	return { ...fields, toJSON: () => fields } as Record<string, unknown>;
}

const parentFields = {
	gitProviderId: "gh",
	gitRepo: "acme/app",
	id: "parent",
	previewReportGithub: true,
	userId: "u1",
};

const preview = row({
	defaultDomainEnabled: true,
	dnsResolvable: true,
	domains: [],
	gitRef: "feat/x",
	id: "prev",
	previewBranch: "feat/x",
	previewParentId: "parent",
	previewPrNumber: 12,
	primaryDomain: null,
	slug: "app-pr-12",
	stackId: null,
}) as unknown as Preview;

const deployment = row({
	gitCommit: "abcdef1234567890",
	id: "dep1",
}) as unknown as Deployment;

const originalOrigin = config.auth.origin;
let providerKind = "github";
let parent: Record<string, unknown> = {};
let existingComments: unknown[] = [];
let deleteRefused = false;
let calls: Call[] = [];
let warnings: string[] = [];

beforeEach(() => {
	providerKind = "github";
	parent = row(parentFields);
	existingComments = [];
	deleteRefused = false;
	calls = [];
	warnings = [];
	config.auth.origin = "https://homerun.example.com/";
	stub(Logger.prototype, "info", () => undefined);
	stub(Logger.prototype, "warn", (message: string) => {
		warnings.push(message);
	});
	stub(ServiceDTO, "get", async () => parent);
	stub(InstanceSettingsDTO, "get", async () => ({
		gitProviders: [
			{ enabled: true, id: "gh", kind: providerKind, name: "GitHub" },
		],
	}));
	stub(GitConnectionDTO, "getForUserAndProvider", async () => ({ id: "c" }));
	stub(
		GitProviderService,
		"api",
		async (
			_provider: unknown,
			_connection: unknown,
			path: string,
			init: { body?: Record<string, unknown>; method?: string } = {},
		) => {
			const method = init.method ?? "GET";
			calls.push({ body: init.body, method, path });
			if (method === "DELETE" && deleteRefused) {
				throw new Error("GitHub answered 403");
			}
			if (path.includes("/comments?")) {
				return Response.json(existingComments);
			}
			if (path.includes("/deployments?")) {
				return Response.json([{ id: 1 }, { id: 2 }]);
			}
			if (path.endsWith("/deployments")) {
				return Response.json({ id: 99 });
			}
			return Response.json({});
		},
	);
});

afterEach(() => {
	config.auth.origin = originalOrigin;
	restoreStubs();
});

/** Lets the fire-and-forget report run to completion. */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("previewCommentBody", () => {
	test("lists the URLs and the log on success", () => {
		expect(
			previewCommentBody({
				commit: "abcdef123",
				logUrl: "https://h/log",
				ok: true,
				urls: ["https://a", "https://b"],
			}),
		).toBe(
			"✅ **Preview deployed** from `abcdef1`.\n\n- https://a\n- https://b\n\n[Deployment log](https://h/log)",
		);
	});

	test("drops the URLs on failure", () => {
		expect(
			previewCommentBody({
				commit: null,
				logUrl: null,
				ok: false,
				urls: ["https://a"],
			}),
		).toBe("❌ **Preview failed to deploy**.");
	});
});

describe("GitHubReportService.deployed", () => {
	test("posts a comment and a deployment with its status", async () => {
		GitHubReportService.deployed(preview, deployment, true);
		await settle();
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"GET /repos/acme/app/issues/12/comments?per_page=100",
			"POST /repos/acme/app/issues/12/comments",
			"POST /repos/acme/app/deployments",
			"POST /repos/acme/app/deployments/99/statuses",
		]);
		expect(String(calls[1]?.body?.body)).toStartWith(
			`${PREVIEW_COMMENT_MARKER}\n✅ **Preview deployed** from \`abcdef1\`.`,
		);
		expect(calls[2]?.body).toMatchObject({
			environment: "app-pr-12",
			ref: "abcdef1234567890",
			required_contexts: [],
			transient_environment: true,
		});
		expect(calls[3]?.body).toMatchObject({
			environment_url: expect.stringContaining("https://app-pr-12."),
			log_url:
				"https://homerun.example.com/services/prev/environments/revisions/dep1",
			state: "success",
		});
	});

	test("edits its own comment instead of posting another", async () => {
		existingComments = [
			{ body: "a reviewer", id: 1 },
			{ body: `${PREVIEW_COMMENT_MARKER}\nold`, id: 2 },
		];
		GitHubReportService.deployed(preview, deployment, false);
		await settle();
		expect(calls[1]).toMatchObject({
			method: "PATCH",
			path: "/repos/acme/app/issues/comments/2",
		});
		expect(calls[3]?.body?.state).toBe("failure");
	});

	test("logs rather than throws when GitHub creates no deployment", async () => {
		stub(
			GitProviderService,
			"api",
			async (_p: unknown, _c: unknown, path: string) =>
				path.endsWith("/deployments")
					? Response.json({ message: "checks pending" })
					: Response.json([]),
		);
		GitHubReportService.deployed(preview, deployment, true);
		await settle();
		expect(warnings).toHaveLength(1);
	});

	test("the service's own deploy goes to its production environment, no comment", async () => {
		GitHubReportService.deployed(
			row({
				...parentFields,
				channelCanary: false,
				defaultDomainEnabled: true,
				dnsResolvable: true,
				domains: [],
				environmentName: null,
				gitRef: "main",
				previewParentId: null,
				previewPrNumber: null,
				primaryDomain: null,
				slug: "app",
				stackId: null,
			}) as unknown as Preview,
			deployment,
			true,
		);
		await settle();
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"POST /repos/acme/app/deployments",
			"POST /repos/acme/app/deployments/99/statuses",
		]);
		expect(calls[0]?.body).toMatchObject({
			environment: "production",
			production_environment: true,
			transient_environment: false,
		});
	});

	test("a canary reports to its parent's repo as the canary environment", async () => {
		GitHubReportService.deployed(
			row({
				channelCanary: true,
				defaultDomainEnabled: true,
				dnsResolvable: true,
				domains: [],
				environmentName: null,
				gitRef: "main",
				id: "canary",
				previewParentId: "parent",
				previewPrNumber: null,
				primaryDomain: null,
				slug: "app-canary",
				stackId: null,
			}) as unknown as Preview,
			deployment,
			true,
		);
		await settle();
		expect(calls).toHaveLength(2);
		expect(calls[0]?.body).toMatchObject({
			environment: "canary",
			production_environment: false,
			transient_environment: false,
		});
	});

	test("does nothing for a service that doesn't report", async () => {
		GitHubReportService.deployed(
			row({ id: "plain", previewParentId: null }) as unknown as Preview,
			deployment,
			true,
		);
		await settle();
		expect(calls).toHaveLength(0);
	});

	test("does nothing when the parent turned reporting off", async () => {
		parent = row({ ...parentFields, previewReportGithub: false });
		GitHubReportService.deployed(preview, deployment, true);
		await settle();
		expect(calls).toHaveLength(0);
	});

	test("does nothing for a repo on another provider", async () => {
		providerKind = "gitlab";
		GitHubReportService.deployed(preview, deployment, true);
		await settle();
		expect(calls).toHaveLength(0);
	});
});

describe("GitHubReportService.closed", () => {
	test("rewrites the comment, deactivates every deployment and deletes the environment", async () => {
		GitHubReportService.closed(parent as unknown as Parent, preview);
		await settle();
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"GET /repos/acme/app/issues/12/comments?per_page=100",
			"POST /repos/acme/app/issues/12/comments",
			"GET /repos/acme/app/deployments?environment=app-pr-12&per_page=100",
			"POST /repos/acme/app/deployments/1/statuses",
			"POST /repos/acme/app/deployments/2/statuses",
			"DELETE /repos/acme/app/environments/app-pr-12",
		]);
		expect(calls[3]?.body).toEqual({ state: "inactive" });
	});

	test("a refused environment delete is not a failure", async () => {
		deleteRefused = true;
		GitHubReportService.closed(parent as unknown as Parent, preview);
		await settle();
		expect(warnings).toHaveLength(0);
	});
});

describe("GitHubReportService.environmentRemoved", () => {
	test("deactivates and deletes the environment's GitHub environment", async () => {
		GitHubReportService.environmentRemoved(parent as unknown as Parent, "demo");
		await settle();
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"GET /repos/acme/app/deployments?environment=demo&per_page=100",
			"POST /repos/acme/app/deployments/1/statuses",
			"POST /repos/acme/app/deployments/2/statuses",
			"DELETE /repos/acme/app/environments/demo",
		]);
	});
});
