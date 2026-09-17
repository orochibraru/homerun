import { describe, expect, test } from "bun:test";
import { BUILD_METHODS, isBuildMethod } from "$lib/build-methods";
import {
	BUILDER_CHECKSUMS,
	BUILDER_HELPER_TAG,
	BUILDER_SCRIPT,
	bakeTargetName,
	buildCacheRef,
	builderBuildDir,
	builderEnv,
	builderFilePath,
	buildFailureMessage,
	createLineSplitter,
	PACK_BUILDERS,
} from "$lib/services/docker/builder-run";

const registry = {
	password: "s3cret",
	registryUrl: "registry.example.com/",
	username: "builder",
};

describe("builderBuildDir", () => {
	test("uses the repo root for a blank or dot context", () => {
		expect(builderBuildDir("/workspace/repo", null)).toBe("/workspace/repo");
		expect(builderBuildDir("/workspace/repo", "  ")).toBe("/workspace/repo");
		expect(builderBuildDir("/workspace/repo", "/")).toBe("/workspace/repo");
		expect(builderBuildDir("/workspace/repo", ".")).toBe("/workspace/repo");
	});

	test("trims slashes around a subdirectory", () => {
		expect(builderBuildDir("/workspace/repo", "/apps/web/")).toBe(
			"/workspace/repo/apps/web",
		);
	});

	test("refuses a context that leaves the repository", () => {
		expect(() => builderBuildDir("/workspace/repo", "../etc")).toThrow();
		expect(() => builderBuildDir("/workspace/repo", "a/../../b")).toThrow();
	});
});

describe("builderEnv", () => {
	test("passes user input only as variables, with a per-service pack cache key", () => {
		const env = builderEnv({
			buildContext: "api",
			method: "heroku",
			repoDir: "/workspace/repo",
			tag: "homerun-build-api:1700000000",
		});
		expect(env).toContain("BUILD_METHOD=heroku");
		expect(env).toContain("BUILD_DIR=/workspace/repo/api");
		expect(env).toContain("IMAGE_TAG=homerun-build-api:1700000000");
		expect(env).toContain("PACK_VOLUME_KEY=homerun-build-api");
		expect(env).toContain(`PACK_BUILDER=${PACK_BUILDERS.heroku}`);
	});

	test("only buildpack methods get a pack builder", () => {
		const env = builderEnv({
			buildContext: null,
			method: "railpack",
			repoDir: "/workspace/repo",
			tag: "x:1",
		});
		expect(env.some((line) => line.startsWith("PACK_BUILDER="))).toBe(false);
		expect(
			builderEnv({
				buildContext: null,
				method: "paketo",
				repoDir: "/r",
				tag: "x:1",
			}),
		).toContain(`PACK_BUILDER=${PACK_BUILDERS.paketo}`);
	});
});

describe("builderFilePath", () => {
	test("resolves relative to the build context with a default", () => {
		expect(
			builderFilePath(
				"/workspace/repo",
				"/workspace/repo/api",
				null,
				"Dockerfile",
			),
		).toBe("/workspace/repo/api/Dockerfile");
		expect(
			builderFilePath(
				"/workspace/repo",
				"/workspace/repo/api",
				"../docker/api.Dockerfile",
				"Dockerfile",
			),
		).toBe("/workspace/repo/docker/api.Dockerfile");
	});

	test("refuses a file outside the repository", () => {
		expect(() =>
			builderFilePath(
				"/workspace/repo",
				"/workspace/repo",
				"../x",
				"Dockerfile",
			),
		).toThrow();
		expect(() =>
			builderFilePath("/workspace/repo", "/workspace/repo", "..", "Dockerfile"),
		).toThrow();
	});
});

describe("bakeTargetName", () => {
	test("defaults to default and rejects anything that isn't a plain name", () => {
		expect(bakeTargetName(null)).toBe("default");
		expect(bakeTargetName("  api_v2-web ")).toBe("api_v2-web");
		expect(() => bakeTargetName("--push")).toThrow();
		expect(() => bakeTargetName("api.tags")).toThrow();
		expect(() => bakeTargetName("a b")).toThrow();
		expect(() => bakeTargetName("*")).toThrow();
	});
});

describe("builderEnv for BuildKit methods", () => {
	test("a Dockerfile build gets the resolved Dockerfile and no cache without a registry", () => {
		const env = builderEnv({
			buildContext: "api",
			dockerfilePath: "docker/Dockerfile.prod",
			method: "dockerfile",
			repoDir: "/workspace/repo",
			tag: "homerun-build-api:1",
		});
		expect(env).toContain(
			"BUILD_FILE=/workspace/repo/api/docker/Dockerfile.prod",
		);
		expect(env).toContain("CACHE_REF=");
		expect(env.some((line) => line.startsWith("BAKE_TARGET="))).toBe(false);
	});

	test("a bake build gets its file and target, defaulting both", () => {
		const env = builderEnv({
			buildContext: null,
			method: "bake",
			repoDir: "/workspace/repo",
			tag: "homerun-build-api:1",
		});
		expect(env).toContain("BUILD_FILE=/workspace/repo/docker-bake.hcl");
		expect(env).toContain("BAKE_TARGET=default");
		expect(
			builderEnv({
				bakeFile: "compose.yaml",
				bakeTarget: "web",
				buildContext: "apps",
				method: "bake",
				repoDir: "/workspace/repo",
				tag: "x:1",
			}),
		).toEqual(
			expect.arrayContaining([
				"BUILD_FILE=/workspace/repo/apps/compose.yaml",
				"BAKE_TARGET=web",
			]),
		);
	});

	test("a cache registry becomes a per-service registry cache ref and login", () => {
		const env = builderEnv({
			buildContext: null,
			cacheRegistry: registry,
			method: "dockerfile",
			repoDir: "/workspace/repo",
			tag: "homerun-build-api:1",
		});
		expect(env).toContain(
			"CACHE_REF=registry.example.com/homerun-build-api:buildcache",
		);
		expect(env).toContain("CACHE_REGISTRY=registry.example.com/");
		expect(env).toContain("CACHE_USERNAME=builder");
		expect(env).toContain("CACHE_PASSWORD=s3cret");
		expect(buildCacheRef(registry, "a:b")).toBe(
			"registry.example.com/a:buildcache",
		);
	});
});

describe("buildFailureMessage", () => {
	test("prefers the last BuildKit ERROR line", () => {
		expect(
			buildFailureMessage("dockerfile", 1, [
				"#5 [2/3] COPY --chmod=755 a /a",
				"#5 ERROR: failed to calculate checksum",
				"------",
				"ERROR: failed to build: failed to solve: not found",
				"",
			]),
		).toBe(
			"The dockerfile build failed (exit code 1): ERROR: failed to build: failed to solve: not found",
		);
	});

	test("falls back to an error mention, then the last line, then nothing", () => {
		expect(
			buildFailureMessage("nixpacks", 2, ["Error: no provider", "bye"]),
		).toBe("The nixpacks build failed (exit code 2): Error: no provider");
		expect(buildFailureMessage("bake", 3, ["just this"])).toBe(
			"The bake build failed (exit code 3): just this",
		);
		expect(buildFailureMessage("bake", 3, [])).toBe(
			"The bake build failed (exit code 3).",
		);
	});
});

describe("BUILDER_SCRIPT", () => {
	test("runs BuildKit for Dockerfile and bake builds, with a registry cache", () => {
		expect(BUILDER_HELPER_TAG).toMatch(/^\d+\.\d+\.\d+-cli$/);
		expect(BUILDER_SCRIPT).toContain(
			'set -- build --progress plain -f "$BUILD_FILE" -t "$IMAGE_TAG" --load',
		);
		expect(BUILDER_SCRIPT).toContain(
			'--set "$targets.tags=$IMAGE_TAG" --set "$targets.output=type=docker"',
		);
		expect(BUILDER_SCRIPT).toContain('exec docker buildx "$@" "$BAKE_TARGET"');
		expect(BUILDER_SCRIPT).toContain(
			'--cache-to "type=registry,ref=$CACHE_REF,mode=max,ignore-error=true"',
		);
		expect(BUILDER_SCRIPT).toContain("--driver docker-container");
		expect(BUILDER_SCRIPT).toContain("--password-stdin");
		expect(BUILDER_SCRIPT).not.toContain("buildImage");
	});

	test("handles every build method and never interpolates input", () => {
		for (const method of BUILD_METHODS) {
			expect(BUILDER_SCRIPT).toContain(method);
		}
		expect(BUILDER_SCRIPT).not.toContain("${");
		expect(BUILDER_SCRIPT).toContain('--name "$IMAGE_TAG"');
		expect(BUILDER_SCRIPT).toContain("railpack-frontend");
		expect(BUILDER_SCRIPT).toContain("--trust-builder");
	});
});

describe("builder checksums", () => {
	test("every tool has a sha256 archive and binary checksum per arch, all in the script", () => {
		for (const tool of Object.values(BUILDER_CHECKSUMS)) {
			for (const arch of ["amd64", "arm64"] as const) {
				for (const digest of [tool[arch].archive, tool[arch].binary]) {
					expect(digest).toMatch(/^[0-9a-f]{64}$/);
					expect(BUILDER_SCRIPT).toContain(digest);
				}
			}
		}
	});

	test("verifies before installing and re-verifies a cached binary", () => {
		expect(BUILDER_SCRIPT).toContain('[ "$(sha "/tools/$1")" = "$5" ]');
		expect(BUILDER_SCRIPT).toContain('[ "$(sha "$tmp/archive")" != "$4" ]');
		expect(BUILDER_SCRIPT).toContain("Checksum mismatch");
		expect(BUILDER_SCRIPT.indexOf('"$(sha "$tmp/$3")" != "$5"')).toBeLessThan(
			BUILDER_SCRIPT.indexOf('mv -f "$tmp/$3"'),
		);
	});
});

describe("createLineSplitter", () => {
	test("buffers partial lines, splits carriage returns and drops blanks", () => {
		const lines: string[] = [];
		const splitter = createLineSplitter((line) => lines.push(line));
		splitter.push("Downloading nix");
		splitter.push("packs...\n\n#1 [internal] load\r#1 DONE  \n");
		splitter.push("tail");
		expect(lines).toEqual([
			"Downloading nixpacks...",
			"#1 [internal] load",
			"#1 DONE",
		]);
		splitter.flush();
		expect(lines.at(-1)).toBe("tail");
	});
});

describe("isBuildMethod", () => {
	test("accepts known methods only", () => {
		expect(isBuildMethod("nixpacks")).toBe(true);
		expect(isBuildMethod("static")).toBe(false);
		expect(isBuildMethod(undefined)).toBe(false);
	});
});
