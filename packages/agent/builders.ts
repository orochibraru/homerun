import { posix } from "node:path";
import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import type Docker from "dockerode";

/** Every build method the main app's `$lib/build-methods.ts` knows, hand-mirrored (the agent can't import from src/). */
export const BUILD_METHODS = [
	"dockerfile",
	"bake",
	"nixpacks",
	"railpack",
	"heroku",
	"paketo",
] as const;

export type BuildMethod = (typeof BUILD_METHODS)[number];

export const DEFAULT_BAKE_FILE = "docker-bake.hcl";
export const DEFAULT_BAKE_TARGET = "default";
export const BAKE_TARGET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export const BUILDER_HELPER_IMAGE = "docker:29.8.1-cli";
export const BUILDER_TOOLS_VOLUME = "homerun-builder-tools";
export const NIXPACKS_VERSION = "1.41.0";
export const RAILPACK_VERSION = "0.39.0";
export const PACK_VERSION = "0.40.9";
const BUILDER_TIMEOUT_MS = 60 * 60 * 1000;
const RECENT_LINE_LIMIT = 40;
const CONTAINER_SOCKET = "/var/run/docker.sock";

export const PACK_BUILDERS: Record<"heroku" | "paketo", string> = {
	heroku: "heroku/builder:24",
	paketo: "paketobuildpacks/builder-jammy-base",
};

export interface BuilderChecksum {
	archive: string;
	binary: string;
}

export type BuilderTool = "nixpacks" | "pack" | "railpack";

export const BUILDER_CHECKSUMS: Record<
	BuilderTool,
	Record<"amd64" | "arm64", BuilderChecksum>
> = {
	nixpacks: {
		amd64: {
			archive:
				"0f55de7874507b9cf7502113120bd96f2ab6979f78d10eaf2eb2ade9207b3af6",
			binary:
				"c3b5165797767ba461ffdf10628913a3459f0331ba887e1a514cc0ef8dce3512",
		},
		arm64: {
			archive:
				"912bd02dd2bb6f9c3a9ed965fe8a68b4aa318dc7a2546e2eca6f2806a894ba39",
			binary:
				"e528215fc8e1a15672cdeb19734fca4432d085f353d9d77712adc41ace980316",
		},
	},
	pack: {
		amd64: {
			archive:
				"dc0ee1e931cf8a106d7555a01a214864f9acb60b77adf15d69b74df4404758e9",
			binary:
				"2f85c3ec624f73f2d3c4a680a2c48fe6755197844730cc4ea5ed05f950fe05a3",
		},
		arm64: {
			archive:
				"091ccb213823656c727731537ef8f1000eb4dc3ec61641506653e7f9d6da0c5e",
			binary:
				"b430c857e8fb543167e44a189d4b39df1e4d585a7052a24d3d5af9b5df941c3b",
		},
	},
	railpack: {
		amd64: {
			archive:
				"728407f5cdb9e9bc1cdd07f568419344a20e71b0a5a9fd90a9cfbaca0a6c94f7",
			binary:
				"4f27a5ad95d146b291eb967cbb7bb85758ac79be7425c7417fa289339feaaf4a",
		},
		arm64: {
			archive:
				"42eb3fa68e38f44be3610a7d74f714ec0d808d70c105fbe35e053b6e6cfb20be",
			binary:
				"a11c65a6cd293c4d6b11c53aa6752810d2e31c11f1410e5f23a7329601cd3af4",
		},
	},
};

export const BUILDER_SCRIPT = `set -eu
case "$(uname -m)" in
  x86_64|amd64)
    nix=x86_64-unknown-linux-musl; rail=x86_64-unknown-linux-musl; pk=linux
    nix_archive=${BUILDER_CHECKSUMS.nixpacks.amd64.archive}; nix_binary=${BUILDER_CHECKSUMS.nixpacks.amd64.binary}
    rail_archive=${BUILDER_CHECKSUMS.railpack.amd64.archive}; rail_binary=${BUILDER_CHECKSUMS.railpack.amd64.binary}
    pk_archive=${BUILDER_CHECKSUMS.pack.amd64.archive}; pk_binary=${BUILDER_CHECKSUMS.pack.amd64.binary}
    ;;
  aarch64|arm64)
    nix=aarch64-unknown-linux-musl; rail=arm64-unknown-linux-musl; pk=linux-arm64
    nix_archive=${BUILDER_CHECKSUMS.nixpacks.arm64.archive}; nix_binary=${BUILDER_CHECKSUMS.nixpacks.arm64.binary}
    rail_archive=${BUILDER_CHECKSUMS.railpack.arm64.archive}; rail_binary=${BUILDER_CHECKSUMS.railpack.arm64.binary}
    pk_archive=${BUILDER_CHECKSUMS.pack.arm64.archive}; pk_binary=${BUILDER_CHECKSUMS.pack.arm64.binary}
    ;;
  *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
sha() {
  sha256sum "$1" | cut -d " " -f 1
}
fetch() {
  if [ -f "/tools/$1" ] && [ "$(sha "/tools/$1")" = "$5" ]; then
    return 0
  fi
  echo "Downloading $1..."
  tmp="/tools/.tmp-$1"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  wget -qO "$tmp/archive" "$2"
  if [ "$(sha "$tmp/archive")" != "$4" ]; then
    rm -rf "$tmp"
    echo "Checksum mismatch for the downloaded $1 archive (expected sha256 $4), refusing to run it." >&2
    exit 1
  fi
  tar -xzf "$tmp/archive" -C "$tmp"
  if [ ! -f "$tmp/$3" ] || [ "$(sha "$tmp/$3")" != "$5" ]; then
    rm -rf "$tmp"
    echo "Checksum mismatch for the extracted $1 binary (expected sha256 $5), refusing to run it." >&2
    exit 1
  fi
  chmod 755 "$tmp/$3"
  mv -f "$tmp/$3" "/tools/$1"
  rm -rf "$tmp"
}
use_cache_builder() {
  if [ -n "$CACHE_USERNAME" ]; then
    printf '%s' "$CACHE_PASSWORD" | docker login "$CACHE_REGISTRY" --username "$CACHE_USERNAME" --password-stdin >/dev/null
  fi
  export BUILDX_CONFIG=/tools/buildx
  if ! docker buildx inspect --bootstrap homerun-cache >/dev/null 2>&1; then
    docker buildx create --name homerun-cache --driver docker-container --driver-opt network=host >/dev/null 2>&1 || true
    docker buildx inspect --bootstrap homerun-cache >/dev/null
  fi
}
if [ ! -d "$BUILD_DIR" ]; then
  echo "Build context $BUILD_DIR doesn't exist in the repository." >&2
  exit 1
fi
case "$BUILD_METHOD" in
  dockerfile)
    if [ ! -f "$BUILD_FILE" ]; then
      echo "Dockerfile $BUILD_FILE doesn't exist in the repository." >&2
      exit 1
    fi
    set -- build --progress plain -f "$BUILD_FILE" -t "$IMAGE_TAG" --load
    if [ -n "$CACHE_REF" ]; then
      use_cache_builder
      set -- "$@" --builder homerun-cache --cache-from "type=registry,ref=$CACHE_REF" --cache-to "type=registry,ref=$CACHE_REF,mode=max,ignore-error=true"
    fi
    exec docker buildx "$@" "$BUILD_DIR"
    ;;
  bake)
    if [ ! -f "$BUILD_FILE" ]; then
      echo "Bake file $BUILD_FILE doesn't exist in the repository." >&2
      exit 1
    fi
    cd "$BUILD_DIR"
    definition=$(docker buildx bake --progress quiet -f "$BUILD_FILE" --print "$BAKE_TARGET")
    targets=$(printf '%s\\n' "$definition" | awk '/^  "target": [{]/ {inside=1; next} inside && /^  [}]/ {inside=0} inside && /^    "[^"]+": [{]/ {sub(/^    "/, ""); sub(/".*/, ""); print}')
    count=$(printf '%s\\n' "$targets" | grep -c . || true)
    if [ "$count" != 1 ]; then
      echo "The bake target $BAKE_TARGET resolves to $count targets ($(echo $targets)), pick a single target." >&2
      exit 1
    fi
    set -- bake --progress plain -f "$BUILD_FILE" --set "$targets.tags=$IMAGE_TAG" --set "$targets.output=type=docker"
    if [ -n "$CACHE_REF" ]; then
      use_cache_builder
      set -- "$@" --builder homerun-cache --set "$targets.cache-from=type=registry,ref=$CACHE_REF" --set "$targets.cache-to=type=registry,ref=$CACHE_REF,mode=max,ignore-error=true"
    fi
    exec docker buildx "$@" "$BAKE_TARGET"
    ;;
  nixpacks)
    fetch "nixpacks-$NIXPACKS_VERSION" "https://github.com/railwayapp/nixpacks/releases/download/v$NIXPACKS_VERSION/nixpacks-v$NIXPACKS_VERSION-$nix.tar.gz" nixpacks "$nix_archive" "$nix_binary"
    exec "/tools/nixpacks-$NIXPACKS_VERSION" build "$BUILD_DIR" --name "$IMAGE_TAG"
    ;;
  railpack)
    fetch "railpack-$RAILPACK_VERSION" "https://github.com/railwayapp/railpack/releases/download/v$RAILPACK_VERSION/railpack-v$RAILPACK_VERSION-$rail.tar.gz" railpack "$rail_archive" "$rail_binary"
    "/tools/railpack-$RAILPACK_VERSION" prepare "$BUILD_DIR" --plan-out /tmp/railpack-plan.json --info-out /tmp/railpack-info.json
    set -- build --progress plain --build-arg "BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v$RAILPACK_VERSION" -f /tmp/railpack-plan.json -t "$IMAGE_TAG" --load
    if [ -n "$CACHE_REF" ]; then
      use_cache_builder
      set -- "$@" --builder homerun-cache --cache-from "type=registry,ref=$CACHE_REF" --cache-to "type=registry,ref=$CACHE_REF,mode=max,ignore-error=true"
    fi
    exec docker buildx "$@" "$BUILD_DIR"
    ;;
  heroku|paketo)
    fetch "pack-$PACK_VERSION" "https://github.com/buildpacks/pack/releases/download/v$PACK_VERSION/pack-v$PACK_VERSION-$pk.tgz" pack "$pk_archive" "$pk_binary"
    exec "/tools/pack-$PACK_VERSION" build "$IMAGE_TAG" --builder "$PACK_BUILDER" --path "$BUILD_DIR" --trust-builder --pull-policy if-not-present --network bridge
    ;;
  *)
    echo "Unknown build method $BUILD_METHOD" >&2
    exit 1
    ;;
esac
`;

/**
 * The directory the builder is pointed at, hand-mirrored from the main app's
 * `docker/builder-run.ts` `builderBuildDir`.
 *
 * @throws When the context tries to leave the repository with `..`.
 */
export function builderBuildDir(
	repoDir: string,
	buildContext: string | null | undefined,
): string {
	const trimmed = (buildContext ?? "").trim().replace(/^\/+|\/+$/g, "");
	if (trimmed === "" || trimmed === ".") {
		return repoDir;
	}
	if (trimmed.split("/").includes("..")) {
		throw new Error("The build context can't leave the repository.");
	}
	return `${repoDir}/${trimmed}`;
}

export interface BuilderCacheRegistry {
	password: string;
	registryUrl: string;
	username: string;
}

/**
 * A build definition file resolved against the build context, hand-mirrored
 * from the main app's `builderFilePath`.
 *
 * @throws When the resolved path leaves the repository.
 */
export function builderFilePath(
	repoDir: string,
	buildDir: string,
	file: string | null | undefined,
	fallback: string,
): string {
	const relative = (file ?? "").trim().replace(/^\/+/, "") || fallback;
	const resolved = posix.normalize(`${buildDir}/${relative}`);
	if (!resolved.startsWith(`${repoDir}/`)) {
		throw new Error(`The build file ${relative} can't leave the repository.`);
	}
	return resolved;
}

/** The registry ref a service's BuildKit layer cache lives at, hand-mirrored from the main app's `buildCacheRef`. */
export function buildCacheRef(
	registry: BuilderCacheRegistry,
	tag: string,
): string {
	return `${registry.registryUrl.replace(/\/+$/, "")}/${tag.split(":")[0]}:buildcache`;
}

/**
 * The bake target to build, hand-mirrored from the main app's
 * `bakeTargetName`.
 *
 * @throws When the name isn't a plain bake target name.
 */
export function bakeTargetName(target: string | null | undefined): string {
	const name = (target ?? "").trim() || DEFAULT_BAKE_TARGET;
	if (!BAKE_TARGET_PATTERN.test(name)) {
		throw new Error(
			`The bake target ${name} isn't valid, use letters, digits, dashes and underscores.`,
		);
	}
	return name;
}

export interface BuilderRunInput {
	bakeFile?: string | null;
	bakeTarget?: string | null;
	buildContext: string | null | undefined;
	cacheRegistry?: BuilderCacheRegistry | null;
	dockerfilePath?: string | null;
	method: BuildMethod;
	repoDir: string;
	tag: string;
}

/**
 * The builder container's environment, hand-mirrored from the main app's
 * `builderEnv`: user input only ever travels as variables.
 *
 * @throws When the build context, build file or bake target is invalid.
 */
export function builderEnv(input: BuilderRunInput): string[] {
	const buildDir = builderBuildDir(input.repoDir, input.buildContext);
	const cache = input.cacheRegistry ?? null;
	const env: Record<string, string> = {
		BUILD_DIR: buildDir,
		BUILD_METHOD: input.method,
		CACHE_PASSWORD: cache?.password ?? "",
		CACHE_REF: cache ? buildCacheRef(cache, input.tag) : "",
		CACHE_REGISTRY: cache?.registryUrl ?? "",
		CACHE_USERNAME: cache?.username ?? "",
		IMAGE_TAG: input.tag,
		NIXPACKS_VERSION,
		PACK_VERSION,
		PACK_VOLUME_KEY: input.tag.split(":")[0],
		RAILPACK_VERSION,
	};
	if (input.method === "dockerfile") {
		env.BUILD_FILE = builderFilePath(
			input.repoDir,
			buildDir,
			input.dockerfilePath,
			"Dockerfile",
		);
	}
	if (input.method === "bake") {
		env.BUILD_FILE = builderFilePath(
			input.repoDir,
			buildDir,
			input.bakeFile,
			DEFAULT_BAKE_FILE,
		);
		env.BAKE_TARGET = bakeTargetName(input.bakeTarget);
	}
	if (input.method === "heroku" || input.method === "paketo") {
		env.PACK_BUILDER = PACK_BUILDERS[input.method];
	}
	return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

/** A failed build's error with its most telling output line, hand-mirrored from the main app's `buildFailureMessage`. */
export function buildFailureMessage(
	method: BuildMethod,
	exitCode: number,
	recentLines: readonly string[],
): string {
	const lines = recentLines.map((line) => line.trim()).filter(Boolean);
	const cause =
		lines.findLast((line) => /\bERROR\b/.test(line)) ??
		lines.findLast((line) => /error/i.test(line)) ??
		lines.at(-1);
	const summary = `The ${method} build failed (exit code ${exitCode})`;
	return cause ? `${summary}: ${cause.slice(0, 1000)}` : `${summary}.`;
}

/**
 * Runs the build (BuildKit `docker buildx build`/`bake`, Nixpacks, Railpack
 * or pack) in a throwaway `docker:cli` container with the clone's volume,
 * the persistent tools volume and the daemon socket mounted, so the image is
 * tagged straight into this daemon, with the layer cache in `cacheRegistry`
 * when one is given. Output is forwarded to `push` line by line.
 *
 * @throws When the build settings are invalid, or the build exits non-zero
 *   (with its most telling output line) or times out.
 */
export async function runBuilder(
	options: BuilderRunInput & {
		docker: Docker;
		push: (line: string) => void;
		socketPath: string;
		volumeName: string;
		workspace: string;
	},
): Promise<void> {
	const { docker, method, push } = options;
	try {
		await docker.getImage(BUILDER_HELPER_IMAGE).inspect();
	} catch {
		push(`Pulling ${BUILDER_HELPER_IMAGE}...`);
		const stream: NodeJS.ReadableStream = await docker.pull(
			BUILDER_HELPER_IMAGE,
			{},
		);
		await new Promise<void>((resolvePromise, reject) => {
			docker.modem.followProgress(stream, (err) =>
				err ? reject(err) : resolvePromise(),
			);
		});
	}
	push(`Building with ${method}...`);
	const container = await docker.createContainer({
		Cmd: ["-c", BUILDER_SCRIPT],
		Entrypoint: ["sh"],
		Env: builderEnv({
			bakeFile: options.bakeFile,
			bakeTarget: options.bakeTarget,
			buildContext: options.buildContext,
			cacheRegistry: options.cacheRegistry,
			dockerfilePath: options.dockerfilePath,
			method,
			repoDir: options.repoDir,
			tag: options.tag,
		}),
		HostConfig: {
			Binds: [
				`${options.volumeName}:${options.workspace}`,
				`${BUILDER_TOOLS_VOLUME}:/tools`,
				`${options.socketPath}:${CONTAINER_SOCKET}`,
			],
		},
		Image: BUILDER_HELPER_IMAGE,
		Labels: { "homerun.managed": "true" },
		Tty: false,
	});
	let buffer = "";
	const recentLines: string[] = [];
	const emit = (line: string) => {
		if (line.trim() !== "") {
			recentLines.push(line.trimEnd());
			if (recentLines.length > RECENT_LINE_LIMIT) {
				recentLines.shift();
			}
			push(line.trimEnd());
		}
	};
	const output = new PassThrough();
	output.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		const lines = buffer.split(/\r?\n|\r/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			emit(line);
		}
	});
	const raw = (await container.attach({
		stderr: true,
		stdout: true,
		stream: true,
	})) as unknown as Readable & { destroy: () => void };
	docker.modem.demuxStream(raw, output, output);
	const streamDone = new Promise<void>((resolvePromise) => {
		raw.on("end", resolvePromise);
		raw.on("close", resolvePromise);
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		container.kill().catch(() => undefined);
	}, BUILDER_TIMEOUT_MS);
	try {
		await container.start();
		const result = (await container.wait()) as { StatusCode: number };
		await streamDone;
		emit(buffer);
		if (timedOut) {
			throw new Error(`The ${method} build timed out.`);
		}
		if (result.StatusCode !== 0) {
			throw new Error(
				buildFailureMessage(method, result.StatusCode, recentLines),
			);
		}
	} finally {
		clearTimeout(timer);
		raw.destroy();
		await container.remove({ force: true }).catch(() => undefined);
	}
}
