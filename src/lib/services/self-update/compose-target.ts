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

export function containerIdFromMountinfo(mountinfo: string): string | null {
	return MOUNTINFO_CONTAINER_RE.exec(mountinfo)?.[1] ?? null;
}

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
