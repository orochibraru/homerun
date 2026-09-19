import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
	BAKE_TARGET_PATTERN,
	BUILD_METHODS,
	DEFAULT_BAKE_FILE,
	DEFAULT_BAKE_TARGET,
	isBuildMethod,
} from "$lib/build-methods";

describe("the Go builder accepts what the app's forms offer", () => {
	test("same methods and bake defaults", () => {
		const tools = JSON.parse(
			readFileSync(
				join(process.cwd(), "internal/agent/builder-tools.json"),
				"utf8",
			),
		);
		expect({
			bakeTargetPattern: tools.bakeTargetPattern,
			buildMethods: tools.buildMethods,
			defaultBakeFile: tools.defaultBakeFile,
			defaultBakeTarget: tools.defaultBakeTarget,
		}).toEqual({
			bakeTargetPattern: BAKE_TARGET_PATTERN.source,
			buildMethods: [...BUILD_METHODS],
			defaultBakeFile: DEFAULT_BAKE_FILE,
			defaultBakeTarget: DEFAULT_BAKE_TARGET,
		});
	});

	test("only the listed methods are build methods", () => {
		expect(BUILD_METHODS.every(isBuildMethod)).toBe(true);
		expect(isBuildMethod("docker-compose")).toBe(false);
		expect(isBuildMethod(42)).toBe(false);
	});
});
