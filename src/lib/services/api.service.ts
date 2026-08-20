import { Logger } from "$lib/logger";
import type { RegistryAuth } from "./docker/containers.ts";

const logger = new Logger("Docker");

const DOCKER_HUB_HOST = "registry-1.docker.io";
const PROTOCOL_RE = /^https?:\/\//;
const TRAILING_SLASH_RE = /\/$/;
const BEARER_CHALLENGE_RE = /^Bearer\s+(.+)$/i;
const QUOTES_RE = /^"|"$/g;

/** Splits "image:tag" style refs into a registry host + repository path, defaulting to Docker Hub conventions. Pure : stays a plain function, no need for an instance. */
function parseImageRef(
	image: string,
	registryUrl?: string | null,
): { host: string; repo: string } {
	if (registryUrl) {
		const host = registryUrl
			.replace(PROTOCOL_RE, "")
			.replace(TRAILING_SLASH_RE, "");
		return { host, repo: image };
	}

	const [firstSegment] = image.split("/");
	const looksLikeHost =
		firstSegment.includes(".") ||
		firstSegment.includes(":") ||
		firstSegment === "localhost";

	if (looksLikeHost) {
		const [host, ...rest] = image.split("/");
		return { host, repo: rest.join("/") };
	}

	// Bare names ("nginx") and single-namespace names ("user/repo") are both
	// Docker Hub : official images live under the implicit "library/" namespace.
	const repo = image.includes("/") ? image : `library/${image}`;
	return { host: DOCKER_HUB_HOST, repo };
}

interface WwwAuthenticate {
	realm: string;
	scope?: string;
	service?: string;
}

function parseWwwAuthenticate(header: string): WwwAuthenticate | null {
	const match = header.match(BEARER_CHALLENGE_RE);
	if (!match) {
		return null;
	}
	const params: Record<string, string> = {};
	for (const pair of match[1].split(",")) {
		const [key, rawValue] = pair.split("=");
		if (key && rawValue) {
			params[key.trim()] = rawValue.trim().replace(QUOTES_RE, "");
		}
	}
	if (!params.realm) {
		return null;
	}
	return { realm: params.realm, scope: params.scope, service: params.service };
}

async function fetchBearerToken(
	challenge: WwwAuthenticate,
	auth?: RegistryAuth,
): Promise<string | null> {
	const url = new URL(challenge.realm);
	if (challenge.service) {
		url.searchParams.set("service", challenge.service);
	}
	if (challenge.scope) {
		url.searchParams.set("scope", challenge.scope);
	}

	const headers: Record<string, string> = {};
	if (auth?.username) {
		headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
	}

	const res = await fetch(url, { headers });
	if (!res.ok) {
		return null;
	}
	const body = (await res.json()) as { token?: string; access_token?: string };
	return body.token ?? body.access_token ?? null;
}

const MANIFEST_ACCEPT = [
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.oci.image.index.v1+json",
].join(", ");

/**
 * Outbound HTTP calls to third-party APIs : currently just container
 * registries (via the Docker Registry HTTP API v2), distinct from
 * DockerService which only talks to a Docker daemon (local or remote).
 */
class ApiServiceClass {
	/**
	 * Checks whether `image:tag` exists in its registry, via the Docker
	 * Registry HTTP API v2 (a manifest HEAD, not a pull : no layers ever
	 * touch disk). Anonymous-token flow covers public images on Docker Hub,
	 * GHCR, etc.; `auth` is used for private registries.
	 *
	 * Fails open (`exists: true`) on network/parse trouble : this is a
	 * warn-don't-block check, a false negative is worse than a missed check.
	 */
	async checkImageExists(
		image: string,
		tag: string,
		registryUrl?: string | null,
		auth?: RegistryAuth,
	): Promise<{ exists: boolean; checked: boolean }> {
		const { host, repo } = parseImageRef(image, registryUrl);
		const manifestUrl = `https://${host}/v2/${repo}/manifests/${tag}`;

		try {
			let res = await fetch(manifestUrl, {
				headers: { Accept: MANIFEST_ACCEPT },
				method: "HEAD",
			});

			if (res.status === 401) {
				const challenge = res.headers.get("www-authenticate");
				const parsed = challenge ? parseWwwAuthenticate(challenge) : null;
				if (!parsed) {
					return { checked: false, exists: true };
				}
				const token = await fetchBearerToken(parsed, auth);
				if (!token) {
					return { checked: false, exists: true };
				}
				res = await fetch(manifestUrl, {
					headers: {
						Accept: MANIFEST_ACCEPT,
						Authorization: `Bearer ${token}`,
					},
					method: "HEAD",
				});
			}

			if (res.status === 404) {
				return { checked: true, exists: false };
			}
			if (res.ok) {
				return { checked: true, exists: true };
			}
			// Any other status (403, 5xx, unexpected auth requirement) : inconclusive.
			return { checked: false, exists: true };
		} catch (err) {
			logger.warn(`Image existence check failed: ${image}:${tag}`, err);
			return { checked: false, exists: true };
		}
	}
}

export const ApiService = new ApiServiceClass();
