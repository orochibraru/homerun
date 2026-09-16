export const MIRROR_CONTAINER_NAME = "homerun-mirror";
export const MIRROR_IMAGE = "registry";
export const MIRROR_IMAGE_TAG = "2";
export const MIRROR_INTERNAL_PORT = 5000;
export const MIRROR_HOST_PORT = 5055;
export const MIRROR_VOLUME = "homerun-mirror-data";
export const MIRROR_LABEL = "homerun.infra";

export const SKOPEO_IMAGE = "quay.io/skopeo/stable";
export const SKOPEO_TAG = "latest";
export const TRIVY_IMAGE = "aquasec/trivy";
export const TRIVY_TAG = "0.74.0";
export const TRIVY_CACHE_VOLUME = "homerun-trivy-cache";

export const REGISTRY_AUTH_ENV = "HOMERUN_REGISTRY_AUTH";
export const MIRROR_SCAN_SOURCE = "the Homerun mirror";
export const MIRROR_DELETE_ENV = "REGISTRY_STORAGE_DELETE_ENABLED=true";
export const MIRROR_STORAGE_DIR = "/var/lib/registry";
export const MIRROR_REPOSITORIES_DIR = `${MIRROR_STORAGE_DIR}/docker/registry/v2/repositories`;
export const MIRROR_CONFIG_PATH = "/etc/docker/registry/config.yml";

const DOCKER_HUB = "docker.io";
const DIGEST_RE = /sha256:[0-9a-f]{64}/g;

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

/** Encodes a resolved digest into the `tag@digest` convention this app pins revisions by, so a redeploy can pull the exact image a scan approved. */
export function pinnedToDigest(
	image: string,
	tag: string,
	digest: string,
): { image: string; tag: string } {
	return { image, tag: `${tag}@${digest}` };
}

/** The last `sha256:...` digest mentioned in skopeo/trivy CLI output, or null if none appears. */
export function extractDigest(output: string): string | null {
	const matches = output.match(DIGEST_RE);
	return matches?.at(-1) ?? null;
}

/**
 * Builds a Docker-style `config.json` auth file for `registry`, for skopeo
 * to read via `REGISTRY_AUTH_ENV`. Docker Hub gets both its canonical
 * (`docker.io`) and legacy (`index.docker.io`) hostnames keyed to the same
 * credentials, since different tools address it under either name.
 */
export function registryAuthFile(
	registry: string,
	credentials: RegistryCredentials,
): string {
	const auth = Buffer.from(
		`${credentials.username}:${credentials.password}`,
	).toString("base64");
	const keys =
		registry === DOCKER_HUB ? [DOCKER_HUB, "index.docker.io"] : [registry];
	return JSON.stringify({
		auths: Object.fromEntries(keys.map((key) => [key, { auth }])),
	});
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
	if (!input.withAuth) {
		return { cmd: [...copy, ...refs], entrypoint: ["skopeo"] };
	}
	return {
		cmd: ["skopeo", ...copy, "--src-authfile", "/tmp/auth.json", ...refs],
		entrypoint: [
			"sh",
			"-c",
			`printf '%s' "$${REGISTRY_AUTH_ENV}" > /tmp/auth.json && exec skopeo "$@"`,
		],
	};
}

function imageSourceFlags(source: TrivySource): string[] {
	switch (source.kind) {
		case "remote":
			return [
				"--image-src",
				"remote",
				...(source.insecure ? ["--insecure"] : []),
			];
		case "docker":
			return ["--image-src", "docker"];
		default:
			return ["--image-src", "docker,remote"];
	}
}

/** The `trivy image` CLI args to vulnerability-scan `ref`, sourcing it from the local daemon, a remote registry, or trying either, per `source`. */
export function trivyImageCommand(ref: string, source: TrivySource): string[] {
	return [
		"image",
		...imageSourceFlags(source),
		"--format",
		"json",
		"--quiet",
		"--scanners",
		"vuln",
		"--severity",
		"UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL",
		"--timeout",
		"15m",
		ref,
	];
}

/**
 * The most useful single line to surface from a failed CLI run's combined
 * output : the last line that looks like an error/fatal/denied/unauthorized
 * message, falling back to the last non-blank line, or `"no output"` when
 * there's nothing at all.
 */
export function lastErrorLine(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return (
		lines.findLast((line) => /error|fatal|denied|unauthorized/i.test(line)) ??
		lines.at(-1) ??
		"no output"
	);
}
