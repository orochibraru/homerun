const DOCKER_HUB_HOST = "registry-1.docker.io";
const PROTOCOL_RE = /^https?:\/\//;
const TRAILING_SLASH_RE = /\/$/;
const BEARER_CHALLENGE_RE = /^Bearer\s+(.+)$/i;
const QUOTES_RE = /^"|"$/g;

/** Splits "image:tag" style refs into a registry host + repository path, defaulting to Docker Hub conventions. */
export function parseImageRef(
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

export interface WwwAuthenticate {
	realm: string;
	scope?: string;
	service?: string;
}

/** Parses a registry's `WWW-Authenticate: Bearer realm=..., service=..., scope=...` challenge header, or null if it isn't a Bearer challenge or has no `realm`. */
export function parseWwwAuthenticate(header: string): WwwAuthenticate | null {
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
