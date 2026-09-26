import { Logger } from "$lib/logger";
import {
	parseImageRef,
	parseWwwAuthenticate,
	type WwwAuthenticate,
} from "$lib/registry-ref";
import type { RegistryAuth } from "./docker/containers.ts";

const logger = new Logger("Docker");

/**
 * Fetches an anonymous (or Basic-auth-backed, when `auth` is given) bearer
 * token from the registry's token realm, per the Docker Registry v2 auth
 * flow. Makes a network request to `challenge.realm`; returns null on any
 * non-2xx response or a missing token in the body, never throws.
 */
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
