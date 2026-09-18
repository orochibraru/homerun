import { describe, expect, test } from "bun:test";
import {
	createServiceApiBody,
	createStackApiBody,
	updateServiceApiBody,
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
