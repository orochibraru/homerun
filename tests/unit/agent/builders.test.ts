import { describe, expect, test } from "bun:test";
import {
	BAKE_TARGET_PATTERN as AGENT_BAKE_TARGET_PATTERN,
	BUILDER_CHECKSUMS as AGENT_CHECKSUMS,
	DEFAULT_BAKE_FILE as AGENT_DEFAULT_BAKE_FILE,
	DEFAULT_BAKE_TARGET as AGENT_DEFAULT_BAKE_TARGET,
	BUILDER_HELPER_IMAGE as AGENT_HELPER_IMAGE,
	BUILD_METHODS as AGENT_METHODS,
	NIXPACKS_VERSION as AGENT_NIXPACKS,
	PACK_VERSION as AGENT_PACK,
	PACK_BUILDERS as AGENT_PACK_BUILDERS,
	RAILPACK_VERSION as AGENT_RAILPACK,
	BUILDER_SCRIPT as AGENT_SCRIPT,
	builderEnv as agentBuilderEnv,
	buildFailureMessage as agentBuildFailureMessage,
} from "../../../packages/agent/builders";
import {
	BAKE_TARGET_PATTERN,
	BUILD_METHODS,
	DEFAULT_BAKE_FILE,
	DEFAULT_BAKE_TARGET,
} from "../../../src/lib/build-methods";
import {
	BUILDER_CHECKSUMS,
	BUILDER_HELPER_IMAGE,
	BUILDER_HELPER_TAG,
	BUILDER_SCRIPT,
	builderEnv,
	buildFailureMessage,
	NIXPACKS_VERSION,
	PACK_BUILDERS,
	PACK_VERSION,
	RAILPACK_VERSION,
} from "../../../src/lib/services/docker/builder-run";

describe("agent builders stay in sync with the main app", () => {
	test("same methods, script, versions and builders", () => {
		expect([...AGENT_METHODS]).toEqual([...BUILD_METHODS]);
		expect(AGENT_SCRIPT).toBe(BUILDER_SCRIPT);
		expect([AGENT_NIXPACKS, AGENT_RAILPACK, AGENT_PACK]).toEqual([
			NIXPACKS_VERSION,
			RAILPACK_VERSION,
			PACK_VERSION,
		]);
		expect(AGENT_PACK_BUILDERS).toEqual(PACK_BUILDERS);
		expect(AGENT_CHECKSUMS).toEqual(BUILDER_CHECKSUMS);
		expect(AGENT_HELPER_IMAGE).toBe(
			`${BUILDER_HELPER_IMAGE}:${BUILDER_HELPER_TAG}`,
		);
		expect([AGENT_DEFAULT_BAKE_FILE, AGENT_DEFAULT_BAKE_TARGET]).toEqual([
			DEFAULT_BAKE_FILE,
			DEFAULT_BAKE_TARGET,
		]);
		expect(AGENT_BAKE_TARGET_PATTERN.source).toBe(BAKE_TARGET_PATTERN.source);
	});

	test("same builder environment", () => {
		const input = {
			buildContext: "/web/",
			method: "paketo" as const,
			repoDir: "/workspace/repo",
			tag: "homerun-build-web:1",
		};
		expect(agentBuilderEnv(input)).toEqual(builderEnv(input));
		const bake = {
			bakeFile: "ci/docker-bake.json",
			bakeTarget: "web",
			buildContext: null,
			cacheRegistry: {
				password: "p",
				registryUrl: "registry.example.com",
				username: "u",
			},
			dockerfilePath: "ignored",
			method: "bake" as const,
			repoDir: "/workspace/repo",
			tag: "homerun-build-web:1",
		};
		expect(agentBuilderEnv(bake)).toEqual(builderEnv(bake));
		const dockerfile = { ...bake, method: "dockerfile" as const };
		expect(agentBuilderEnv(dockerfile)).toEqual(builderEnv(dockerfile));
	});

	test("same failure message", () => {
		const lines = ["#3 ERROR: boom", "ERROR: failed to build: boom"];
		expect(agentBuildFailureMessage("bake", 1, lines)).toBe(
			buildFailureMessage("bake", 1, lines),
		);
	});
});
