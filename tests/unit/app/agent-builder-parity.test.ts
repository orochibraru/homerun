import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
	BAKE_TARGET_PATTERN,
	BUILD_METHODS,
	type BuildMethod,
	DEFAULT_BAKE_FILE,
	DEFAULT_BAKE_TARGET,
} from "$lib/build-methods";
import {
	BUILDER_CHECKSUMS,
	BUILDER_HELPER_IMAGE,
	BUILDER_HELPER_TAG,
	BUILDER_SCRIPT,
	BUILDER_TOOLS_VOLUME,
	type BuilderRunInput,
	builderEnv,
	buildFailureMessage,
	NIXPACKS_VERSION,
	PACK_BUILDERS,
	PACK_VERSION,
	RAILPACK_VERSION,
} from "$lib/services/docker/builder-run";

const AGENT = join(process.cwd(), "cmd/agent");

function read(path: string): string {
	return readFileSync(join(AGENT, path), "utf8");
}

describe("the Go agent's builder stays in sync with the app's", () => {
	// The agent is Go and embeds cmd/agent/builder.sh and builder-tools.json;
	// the app is TypeScript. Neither can import the other, so these files are the
	// contract: this test pins the app to them, and cmd/agent/builders_test.go
	// pins the agent to the very same files.
	test("the agent embeds the app's exact builder script", () => {
		expect(read("builder.sh")).toBe(BUILDER_SCRIPT);
	});

	test("same methods, versions, checksums, images and bake defaults", () => {
		expect(JSON.parse(read("builder-tools.json"))).toEqual({
			bakeTargetPattern: BAKE_TARGET_PATTERN.source,
			buildMethods: [...BUILD_METHODS],
			checksums: BUILDER_CHECKSUMS,
			defaultBakeFile: DEFAULT_BAKE_FILE,
			defaultBakeTarget: DEFAULT_BAKE_TARGET,
			helperImage: `${BUILDER_HELPER_IMAGE}:${BUILDER_HELPER_TAG}`,
			nixpacksVersion: NIXPACKS_VERSION,
			packBuilders: PACK_BUILDERS,
			packVersion: PACK_VERSION,
			railpackVersion: RAILPACK_VERSION,
			toolsVolume: BUILDER_TOOLS_VOLUME,
		});
	});

	test("the same builder environment for every recorded input", () => {
		const fixture = JSON.parse(read("testdata/builder-env.json")) as {
			cases: { env: string[]; input: BuilderRunInput }[];
			errors: { error: string | null; input: BuilderRunInput }[];
		};
		for (const { env, input } of fixture.cases) {
			expect(builderEnv(input)).toEqual(env);
		}
		for (const { error, input } of fixture.errors) {
			if (error === null) {
				expect(() => builderEnv(input)).not.toThrow();
			} else {
				expect(() => builderEnv(input)).toThrow(error);
			}
		}
	});

	test("the same failure message for every recorded build", () => {
		const cases = JSON.parse(read("testdata/build-failure.json")) as {
			exitCode: number;
			lines: string[];
			message: string;
			method: BuildMethod;
		}[];
		for (const { exitCode, lines, message, method } of cases) {
			expect(buildFailureMessage(method, exitCode, lines)).toBe(message);
		}
	});
});
