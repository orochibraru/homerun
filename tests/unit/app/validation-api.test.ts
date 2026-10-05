import { describe, expect, test } from "bun:test";
import {
	createServiceApiBody,
	createServiceFromTemplateApiBody,
	createStackApiBody,
	updateServiceApiBody,
	updateStackApiBody,
} from "../../../src/lib/server/validation/api";

const imageBody = {
	containerPort: 80,
	image: "nginx",
	name: "Web",
	slug: "web",
};

function issuePaths(result: { success: boolean; error?: unknown }): string[] {
	const error = result.error as { issues: Array<{ path: unknown[] }> };
	return error.issues.map((issue) => issue.path.join("."));
}

describe("createServiceApiBody", () => {
	test("accepts an image service and fills in the defaults", () => {
		const parsed = createServiceApiBody.parse(imageBody);
		expect(parsed.buildSource).toBe("image");
		expect(parsed.restartPolicy).toBe("unless-stopped");
		expect(parsed.pullPolicy).toBe("always");
		expect(parsed.gitBuildMethod).toBe("dockerfile");
		expect(parsed.envVars).toEqual({});
		expect(parsed.capAdd).toEqual([]);
		expect(parsed.dnsResolvable).toBe(true);
	});

	test("accepts a git service with a gitUrl and no image", () => {
		const parsed = createServiceApiBody.parse({
			buildSource: "git",
			containerPort: 3000,
			gitUrl: "https://github.com/a/b",
			name: "App",
			slug: "app",
		});
		expect(parsed.buildSource).toBe("git");
	});

	test("requires gitUrl for a git build", () => {
		const result = createServiceApiBody.safeParse({
			buildSource: "git",
			containerPort: 3000,
			name: "App",
			slug: "app",
		});
		expect(result.success).toBe(false);
		expect(issuePaths(result)).toEqual(["gitUrl"]);
	});

	test("requires image for an image build", () => {
		const result = createServiceApiBody.safeParse({
			containerPort: 80,
			name: "Web",
			slug: "web",
		});
		expect(result.success).toBe(false);
		expect(issuePaths(result)).toEqual(["image"]);
	});

	test("rejects a bad slug, port, capability and relative env file", () => {
		const result = createServiceApiBody.safeParse({
			...imageBody,
			capAdd: ["NET ADMIN"],
			containerPort: 70_000,
			envFiles: ["relative/.env"],
			slug: "Not A Slug",
		});
		expect(result.success).toBe(false);
		expect(issuePaths(result)).toEqual(
			expect.arrayContaining([
				"slug",
				"containerPort",
				"capAdd.0",
				"envFiles.0",
			]),
		);
	});
});

describe("updateServiceApiBody", () => {
	test("normalises domains to trimmed lowercase", () => {
		const parsed = updateServiceApiBody.parse({
			domains: [" App.Example.COM "],
			primaryDomain: " App.Example.COM ",
		});
		expect(parsed.domains).toEqual(["app.example.com"]);
		expect(parsed.primaryDomain).toBe("app.example.com");
	});

	test("rejects a domain that isn't a hostname", () => {
		const result = updateServiceApiBody.safeParse({
			domains: ["not a domain"],
		});
		expect(result.success).toBe(false);
	});

	test("accepts an empty patch and nulls where a field can be cleared", () => {
		expect(updateServiceApiBody.parse({})).toEqual({});
		expect(
			updateServiceApiBody.parse({ command: null, cpuLimit: null }),
		).toEqual({ command: null, cpuLimit: null });
	});
});

describe("createStackApiBody", () => {
	test("accepts a name and slug", () => {
		expect(createStackApiBody.parse({ name: "Prod", slug: "prod" })).toEqual({
			name: "Prod",
			slug: "prod",
		});
	});

	test("rejects an empty name", () => {
		expect(
			createStackApiBody.safeParse({ name: "", slug: "prod" }).success,
		).toBe(false);
	});
});

describe("updateServiceApiBody environmentName", () => {
	test("lowercases a custom name and accepts null to reset it", () => {
		expect(
			updateServiceApiBody.parse({ environmentName: " Staging " })
				.environmentName,
		).toBe("staging");
		expect(
			updateServiceApiBody.parse({ environmentName: null }).environmentName,
		).toBeNull();
	});

	test("rejects a reserved or malformed name", () => {
		const reserved = updateServiceApiBody.safeParse({
			environmentName: "canary",
		});
		expect(issuePaths(reserved)).toEqual(["environmentName"]);
		expect(
			updateServiceApiBody.safeParse({ environmentName: "eu prod" }).success,
		).toBe(false);
	});
});

describe("runAsUser", () => {
	test("the API takes a valid user, null, or nothing, and rejects a bad one", () => {
		expect(
			createServiceApiBody.parse({ ...imageBody, runAsUser: "1000:1000" })
				.runAsUser,
		).toBe("1000:1000");
		expect(updateServiceApiBody.parse({ runAsUser: null }).runAsUser).toBe(
			null,
		);
		expect(createServiceApiBody.parse(imageBody).runAsUser).toBeUndefined();
		const bad = updateServiceApiBody.safeParse({ runAsUser: "a b" });
		expect(issuePaths(bad)).toEqual(["runAsUser"]);
	});
});

describe("updateServiceApiBody preview branch filter", () => {
	test("takes glob lists and refuses a pattern with whitespace", () => {
		expect(
			updateServiceApiBody.safeParse({
				previewBranchExclude: ["dependabot/*"],
				previewBranchInclude: ["feat/*"],
			}).success,
		).toBe(true);
		const bad = updateServiceApiBody.safeParse({
			previewBranchExclude: ["a b"],
		});
		expect(bad.success).toBe(false);
		expect(issuePaths(bad)).toEqual(["previewBranchExclude"]);
	});
});

describe("updateServiceApiBody path filters", () => {
	test("blocked and login wall paths are trimmed and kept", () => {
		expect(
			updateServiceApiBody.parse({
				authPaths: [" /admin "],
				authPathsMode: "only",
				blockedPaths: [".env", "*.sql"],
			}),
		).toEqual({
			authPaths: ["/admin"],
			authPathsMode: "only",
			blockedPaths: [".env", "*.sql"],
		});
	});

	test("a pattern matching every path, a bad mode or whitespace is refused", () => {
		expect(
			updateServiceApiBody.safeParse({ blockedPaths: ["/*"] }).success,
		).toBe(false);
		expect(updateServiceApiBody.safeParse({ authPaths: ["a b"] }).success).toBe(
			false,
		);
		expect(
			updateServiceApiBody.safeParse({ authPathsMode: "some" }).success,
		).toBe(false);
	});
});

describe("service settings fields", () => {
	test("PATCH takes every dashboard setting", () => {
		const parsed = updateServiceApiBody.parse({
			buildCacheBuiltin: true,
			channelsEnabled: true,
			cronEnabled: true,
			cronSchedule: "0 3 * * *",
			customSslCert: null,
			customSslKey: null,
			domainPorts: { "A.example.com": 8080 },
			healthcheckIntervalSeconds: 30,
			networkMode: "host",
			publishedPorts: [{ containerPort: 53, hostPort: 5353 }],
			replicas: 3,
			stackId: null,
			tracesEnabled: true,
		});
		expect(parsed.domainPorts).toEqual({ "a.example.com": 8080 });
		expect(parsed.publishedPorts).toEqual([
			{ containerPort: 53, hostPort: 5353, protocol: "tcp" },
		]);
		expect(updateServiceApiBody.safeParse({ replicas: 99 }).success).toBe(
			false,
		);
		expect(
			updateServiceApiBody.safeParse({ healthcheckRetries: 0 }).success,
		).toBe(false);
	});

	test("a create body may carry settings, and a template create needs only the template", () => {
		const parsed = createServiceApiBody.parse({ ...imageBody, replicas: 2 });
		expect(parsed.replicas).toBe(2);
		const fromTemplate = createServiceFromTemplateApiBody.parse({
			templateId: "postgres",
		});
		expect(fromTemplate.templateId).toBe("postgres");
		expect(fromTemplate.name).toBeUndefined();
		expect(
			createServiceFromTemplateApiBody.safeParse({ templateId: "" }).success,
		).toBe(false);
	});

	test("a stack may be nested and patched partially", () => {
		expect(
			createStackApiBody.parse({ name: "Web", parentId: "p", slug: "web" })
				.parentId,
		).toBe("p");
		expect(updateStackApiBody.parse({ icon: null })).toEqual({ icon: null });
		expect(updateStackApiBody.safeParse({ slug: "Not a slug" }).success).toBe(
			false,
		);
	});
});
