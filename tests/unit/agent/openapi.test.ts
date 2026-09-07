import { describe, expect, test } from "bun:test";
import { OpenApiBuilder } from "../../../packages/agent/openapi";
import { AGENT_VERSION } from "../../../packages/agent/version";

describe("OpenApiBuilder.buildDocument", () => {
	const doc = OpenApiBuilder.buildDocument("https://agent.example.com") as {
		components: { securitySchemes: Record<string, unknown> };
		info: { version: string };
		openapi: string;
		paths: Record<string, Record<string, unknown>>;
		servers: { url: string }[];
	};

	test("declares OpenAPI 3.1", () => {
		expect(doc.openapi).toBe("3.1.0");
	});

	test("info.version mirrors AGENT_VERSION, not a hardcoded string", () => {
		expect(doc.info.version).toBe(AGENT_VERSION);
	});

	test("servers[0].url is the base URL passed in", () => {
		expect(doc.servers).toEqual([{ url: "https://agent.example.com" }]);
	});

	test("declares a bearer auth security scheme", () => {
		expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
			scheme: "bearer",
			type: "http",
		});
	});

	test("documents every route the HTTP handler actually serves", () => {
		expect(Object.keys(doc.paths).sort()).toEqual(
			["/v1/build", "/v1/health", "/v1/stats"].sort(),
		);
	});

	test("/v1/health is documented as unauthenticated (no security requirement)", () => {
		expect(doc.paths["/v1/health"].get).not.toHaveProperty("security");
	});

	test("every other route requires bearerAuth", () => {
		const authenticated = Object.entries(doc.paths).filter(
			([path]) => path !== "/v1/health",
		);
		for (const [path, methods] of authenticated) {
			for (const [method, def] of Object.entries(methods)) {
				expect(
					(def as { security?: unknown[] }).security,
					`${method.toUpperCase()} ${path} should require bearerAuth`,
				).toEqual([{ bearerAuth: [] }]);
			}
		}
	});

	test("embedded schemas never leak zod's top-level $schema pointer", () => {
		const json = JSON.stringify(doc);
		expect(json).not.toContain('"$schema"');
	});
});
