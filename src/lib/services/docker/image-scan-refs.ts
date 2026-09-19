export const MIRROR_CONTAINER_NAME = "homerun-mirror";
export const MIRROR_IMAGE = "registry";
export const MIRROR_IMAGE_TAG = "2";
export const MIRROR_INTERNAL_PORT = 5000;
export const MIRROR_HOST_PORT = 5055;
export const MIRROR_VOLUME = "homerun-mirror-data";
export const MIRROR_LABEL = "homerun.infra";

export const SKOPEO_IMAGE = "quay.io/skopeo/stable";
export const SKOPEO_TAG = "latest";

export const REGISTRY_AUTH_ENV = "HOMERUN_REGISTRY_AUTH";
export const MIRROR_SCAN_SOURCE = "the Homerun mirror";
export const MIRROR_DELETE_ENV = "REGISTRY_STORAGE_DELETE_ENABLED=true";
export const MIRROR_STORAGE_DIR = "/var/lib/registry";
export const MIRROR_REPOSITORIES_DIR = `${MIRROR_STORAGE_DIR}/docker/registry/v2/repositories`;
export const MIRROR_CONFIG_PATH = "/etc/docker/registry/config.yml";

export const MIRROR_AUTH_VOLUME = "homerun-registry-auth";
export const MIRROR_AUTH_DIR = "/auth";
export const MIRROR_AUTH_FILE = `${MIRROR_AUTH_DIR}/htpasswd`;
export const MIRROR_AUTH_ENV = [
	"REGISTRY_AUTH=htpasswd",
	"REGISTRY_AUTH_HTPASSWD_REALM=Homerun registry",
	`REGISTRY_AUTH_HTPASSWD_PATH=${MIRROR_AUTH_FILE}`,
];
export const MIRROR_ROUTER = "homerun-registry";
export const REGISTRY_INTERNAL_USERNAME = "homerun-internal";

const DOCKER_HUB = "docker.io";

export interface NormalizedImageRef {
	registry: string;
	repository: string;
	tag: string;
}

export interface MirrorRefs {
	internalRef: string;
	loopbackImage: string;
	loopbackTag: string;
	sourceRef: string;
}

export interface RegistryCredentials {
	password: string;
	username: string;
}

export type TrivySource =
	| { insecure: boolean; kind: "remote" }
	| { kind: "docker" }
	| { kind: "any" };

/**
 * Splits an image ref into registry/repository/tag, applying Docker's own
 * defaulting rules : no registry-looking first path segment means Docker
 * Hub, and a bare (no-slash) repository means an official `library/*` image.
 * Any `@digest` suffix on `image` is dropped first, since a digest isn't
 * part of the registry/repository/tag shape callers need.
 */
export function normalizeImageRef(
	image: string,
	tag: string,
): NormalizedImageRef {
	const bare = image.split("@")[0] ?? image;
	const [first, ...rest] = bare.split("/");
	const hasRegistry =
		rest.length > 0 &&
		(first.includes(".") || first.includes(":") || first === "localhost");
	if (hasRegistry) {
		return { registry: first, repository: rest.join("/"), tag };
	}
	const repository = bare.includes("/") ? bare : `library/${bare}`;
	return { registry: DOCKER_HUB, repository, tag };
}

function mirrorPath(ref: NormalizedImageRef): string {
	return `${ref.registry}/${ref.repository}`.toLowerCase().replaceAll(":", "-");
}

/** The mirror registry's repository path for `image:tag`, e.g. what it's stored under in `homerun-mirror`'s own storage. */
export function mirrorRepository(image: string, tag: string): string {
	return mirrorPath(normalizeImageRef(image, tag));
}

/**
 * The refs a mirror copy needs : the upstream `sourceRef` to copy from, the
 * `internalRef` other containers on the shared network reach the mirrored
 * copy through, and the `loopbackImage`/`loopbackTag` this host's own daemon
 * pulls it back through (127.0.0.1, since the daemon isn't necessarily on
 * the same Docker network as the mirror container).
 */
export function mirrorRefs(image: string, tag: string): MirrorRefs {
	const normalized = normalizeImageRef(image, tag);
	const path = mirrorPath(normalized);
	return {
		internalRef: `${MIRROR_CONTAINER_NAME}:${MIRROR_INTERNAL_PORT}/${path}:${tag}`,
		loopbackImage: `127.0.0.1:${MIRROR_HOST_PORT}/${path}`,
		loopbackTag: tag,
		sourceRef: `${normalized.registry}/${normalized.repository}:${tag}`,
	};
}

/**
 * Builds a Docker-style `config.json` auth file covering several registries at
 * once, for skopeo to read via `REGISTRY_AUTH_ENV`. A mirror copy needs exactly
 * this when the built-in registry has auth on: one file authenticating both the
 * upstream source and the mirror it's being written to.
 */
export function registryAuthFileFor(
	entries: Array<{ credentials: RegistryCredentials; registry: string }>,
): string {
	const auths: Record<string, { auth: string }> = {};
	for (const entry of entries) {
		const auth = Buffer.from(
			`${entry.credentials.username}:${entry.credentials.password}`,
		).toString("base64");
		const keys =
			entry.registry === DOCKER_HUB
				? [DOCKER_HUB, "index.docker.io"]
				: [entry.registry];
		for (const key of keys) {
			auths[key] = { auth };
		}
	}
	return JSON.stringify({ auths });
}

/** Whether `ref` addresses the built-in registry, by either of the two names it answers on. */
export function isMirrorRef(ref: string): boolean {
	return (
		ref.startsWith(`${MIRROR_CONTAINER_NAME}:${MIRROR_INTERNAL_PORT}/`) ||
		ref.startsWith(`127.0.0.1:${MIRROR_HOST_PORT}/`)
	);
}

/**
 * The `cmd`/`entrypoint` to run in a one-off skopeo container to copy
 * `source` to `destination` (mirroring, or a scan target's own copy step).
 * When `withAuth` is set, the entrypoint is a small shell wrapper that
 * writes `REGISTRY_AUTH_ENV`'s contents to a file skopeo reads via
 * `--src-authfile`, rather than passing credentials as plain CLI args where
 * they'd show up in `docker inspect`/process listings.
 */
export function skopeoCopyCommand(input: {
	destination: string;
	destAuth?: boolean;
	source: string;
	withAuth: boolean;
}): { cmd: string[]; entrypoint: string[] } {
	const copy = [
		"copy",
		"--quiet",
		"--dest-tls-verify=false",
		"--digestfile",
		"/dev/stdout",
	];
	const refs = [`docker://${input.source}`, `docker://${input.destination}`];
	if (!(input.withAuth || input.destAuth)) {
		return { cmd: [...copy, ...refs], entrypoint: ["skopeo"] };
	}
	const authFlags = [
		...(input.withAuth ? ["--src-authfile", "/tmp/auth.json"] : []),
		...(input.destAuth ? ["--dest-authfile", "/tmp/auth.json"] : []),
	];
	return {
		cmd: ["skopeo", ...copy, ...authFlags, ...refs],
		entrypoint: [
			"sh",
			"-c",
			`printf '%s' "$${REGISTRY_AUTH_ENV}" > /tmp/auth.json && exec skopeo "$@"`,
		],
	};
}

/**
 * The `cmd`/`entrypoint` to run in a one-off skopeo container that reads
 * `source` out of the mirror and writes it to stdout as a `docker load`
 * tarball tagged `name`, for a daemon that can't pull from the mirror's
 * loopback port (rootless Docker).
 */
export function skopeoArchiveCommand(input: { name: string; source: string }): {
	cmd: string[];
	entrypoint: string[];
} {
	return {
		cmd: [
			"copy",
			"--quiet",
			"--src-tls-verify=false",
			`docker://${input.source}`,
			`docker-archive:/dev/stdout:${input.name}`,
		],
		entrypoint: ["skopeo"],
	};
}

/** Whether a daemon's `docker info` security options mark it as rootless Docker. */
export function isRootlessDaemon(
	securityOptions: string[] | null | undefined,
): boolean {
	return (securityOptions ?? []).some((option) =>
		option.split(",").includes("name=rootless"),
	);
}
