import { dirname, isAbsolute, resolve } from "node:path";

export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
export const COMPOSE_WORKING_DIR_LABEL =
	"com.docker.compose.project.working_dir";
export const COMPOSE_CONFIG_FILES_LABEL =
	"com.docker.compose.project.config_files";

export const UPDATER_CONTAINER_NAME = "homerun-updater";
export const UPDATER_IMAGE = "docker";
export const UPDATER_IMAGE_TAG = "cli";

const CONTAINER_SOCKET_PATH = "/var/run/docker.sock";
const MOUNTINFO_CONTAINER_RE = /\/containers\/([0-9a-f]{64})\//;
const TAG_SAFE_RE = /^[\w.-]+$/;

export interface ComposeTarget {
	configFiles: string[];
	image: string;
	project: string;
	service: string;
	workingDir: string;
}

export interface ImageRef {
	repository: string;
	tag: string | null;
}

/**
 * Reads a running container's own Docker Compose labels to recover the
 * project/service/working-dir/config-files it was launched from, so the
 * updater can run `docker compose ... pull && up -d` against that same
 * project. Returns null if any required label is missing or the working
 * directory isn't an absolute path (i.e. the container wasn't launched via
 * Compose, or the label set is unusable).
 */
export function composeTargetFrom(
	labels: Record<string, string> | null | undefined,
	image: string,
): ComposeTarget | null {
	const project = labels?.[COMPOSE_PROJECT_LABEL]?.trim();
	const service = labels?.[COMPOSE_SERVICE_LABEL]?.trim();
	const workingDir = labels?.[COMPOSE_WORKING_DIR_LABEL]?.trim();
	if (!(project && service && workingDir && isAbsolute(workingDir))) {
		return null;
	}
	const configFiles = (labels?.[COMPOSE_CONFIG_FILES_LABEL] ?? "")
		.split(",")
		.map((file) => file.trim())
		.filter(Boolean)
		.map((file) => (isAbsolute(file) ? file : resolve(workingDir, file)));
	return { configFiles, image, project, service, workingDir };
}

/** Extracts this container's own 64-char id from `/proc/self/mountinfo`'s content, or null if none of its mount paths look like a container overlay path. */
export function containerIdFromMountinfo(mountinfo: string): string | null {
	return MOUNTINFO_CONTAINER_RE.exec(mountinfo)?.[1] ?? null;
}

/** Splits an image reference into repository and tag, defaulting to `"latest"` when untagged and digest-less, or `null` when pinned by digest (`@sha256:...`). */
export function splitImageRef(ref: string): ImageRef {
	const withoutDigest = ref.split("@")[0] ?? ref;
	const lastColon = withoutDigest.lastIndexOf(":");
	const lastSlash = withoutDigest.lastIndexOf("/");
	if (lastColon === -1 || lastColon < lastSlash) {
		return {
			repository: withoutDigest,
			tag: ref.includes("@") ? null : "latest",
		};
	}
	return {
		repository: withoutDigest.slice(0, lastColon),
		tag: withoutDigest.slice(lastColon + 1),
	};
}

/**
 * The tag to rewrite the compose file/`.env` to for `latestVersion`,
 * preserving the current tag's `v` prefix style. Returns null when the
 * current tag is `null`/`"latest"` (nothing to pin, `docker compose pull`
 * already gets the newest image) or already matches the target version.
 */
export function pinnedTagFor(
	currentTag: string | null,
	latestVersion: string,
): string | null {
	if (currentTag === null || currentTag === "latest") {
		return null;
	}
	const bare = latestVersion.replace(/^v/, "");
	const next = /^\d/.test(currentTag) ? bare : `v${bare}`;
	return next === currentTag ? null : next;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/#]/g, "\\$&");
}

/**
 * Builds the shell script the updater container runs: when the current tag
 * is a pinnable version tag, rewrites it in-place across the compose files
 * and `.env` (via `sed`) before `docker compose pull`/`up -d --no-deps` for
 * just this service, so a version-pinned deployment tracks the new release
 * rather than silently staying pinned to the old tag.
 */
export function updaterScript(
	target: ComposeTarget,
	latestVersion: string,
): string {
	const { repository, tag } = splitImageRef(target.image);
	const nextTag = pinnedTagFor(tag, latestVersion);
	const compose = [
		"docker compose",
		`-p ${shellQuote(target.project)}`,
		...target.configFiles.map((file) => `-f ${shellQuote(file)}`),
	].join(" ");
	const lines = ["set -eu", `cd ${shellQuote(target.workingDir)}`];

	if (tag && nextTag && TAG_SAFE_RE.test(tag) && TAG_SAFE_RE.test(nextTag)) {
		const repoName = repository.split("/").pop() ?? repository;
		const imageExpr = `s#(${escapeRegex(repoName)}:)${escapeRegex(tag)}([^A-Za-z0-9_.-]|$)#\\1${nextTag}\\2#g`;
		const envExpr = `s#^(HOMERUN_VERSION=["']?)${escapeRegex(tag)}(["']?[[:space:]]*)$#\\1${nextTag}\\2#`;
		if (target.configFiles.length > 0) {
			lines.push(
				`sed -E -i ${shellQuote(imageExpr)} ${target.configFiles.map(shellQuote).join(" ")}`,
			);
		}
		lines.push(
			`if [ -f .env ]; then sed -E -i ${shellQuote(envExpr)} .env; fi`,
		);
	}

	lines.push(
		`${compose} pull ${shellQuote(target.service)}`,
		`${compose} up -d --no-deps ${shellQuote(target.service)}`,
	);
	return lines.join("\n");
}

/** Bind mounts the updater container needs: the host Docker socket, plus every compose working/config directory so the rewritten files and `docker compose` invocation land on the host's real paths. */
export function updaterBinds(
	target: ComposeTarget,
	hostSocketPath: string,
): string[] {
	const dirs = new Set([
		target.workingDir,
		...target.configFiles.map((file) => dirname(file)),
	]);
	return [
		`${hostSocketPath}:${CONTAINER_SOCKET_PATH}`,
		...[...dirs].map((dir) => `${dir}:${dir}`),
	];
}
