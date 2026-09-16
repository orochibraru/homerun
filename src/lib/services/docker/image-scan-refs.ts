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

export function pinnedToDigest(
	image: string,
	tag: string,
	digest: string,
): { image: string; tag: string } {
	return { image, tag: `${tag}@${digest}` };
}

export function extractDigest(output: string): string | null {
	const matches = output.match(DIGEST_RE);
	return matches?.at(-1) ?? null;
}

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
