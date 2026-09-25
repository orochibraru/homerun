export const OIDC_BASE_PATH = "/api/v1/auth";

export const OIDC_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"groups",
] as const;

export const OIDC_CLAIMS = [
	"sub",
	"name",
	"preferred_username",
	"picture",
	"email",
	"email_verified",
	"groups",
] as const;

export interface OidcUser {
	email: string;
	emailVerified: boolean;
	image?: string | null;
	name: string;
	role?: string | null;
}

export const MCP_PATH = "/api/v1/mcp";

export const CLAUDE_MCP_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/**
 * Whether the MCP server can run on this origin: MCP clients only accept an
 * HTTPS resource, or plain HTTP on a loopback host for development. On any
 * other origin (a LAN IP over HTTP) Homerun runs without it rather than
 * failing to start its auth layer.
 */
export function mcpAllowed(origin: string): boolean {
	if (!URL.canParse(origin)) {
		return false;
	}
	const { hostname, protocol } = new URL(origin);
	if (protocol === "https:") {
		return true;
	}
	const host = hostname.replace(/^\[|\]$/g, "");
	return (
		protocol === "http:" &&
		(host === "localhost" ||
			host.endsWith(".localhost") ||
			host === "::1" ||
			/^127(\.\d{1,3}){3}$/.test(host))
	);
}

/** The MCP endpoint's URL, which is also the audience its access tokens are bound to. */
export function mcpResource(origin: string): string {
	return `${origin.replace(/\/+$/, "")}${MCP_PATH}`;
}

/** The issuer Homerun signs tokens as, derived from the dashboard's origin. */
export function oidcIssuer(origin: string): string {
	return `${origin.replace(/\/+$/, "")}${OIDC_BASE_PATH}`;
}

/** The discovery document URL an app is pointed at to configure "Sign in with Homerun". */
export function oidcDiscoveryUrl(origin: string): string {
	return `${oidcIssuer(origin)}/.well-known/openid-configuration`;
}

/**
 * The profile, email and groups claims a token or the userinfo response
 * carries for `user`, limited to what `scopes` granted. `groups` holds the
 * user's Homerun role (`admin` or `developer`), which is what apps map to
 * their own admin rights. `preferred_username` falls back to the email's
 * local part, since Homerun accounts have no separate username.
 */
export function oidcClaimsFor(
	user: OidcUser,
	scopes: readonly string[],
): Record<string, unknown> {
	const claims: Record<string, unknown> = {};
	if (scopes.includes("profile")) {
		claims.name = user.name;
		claims.preferred_username = user.email.split("@")[0] ?? user.email;
		if (user.image) {
			claims.picture = user.image;
		}
	}
	if (scopes.includes("email")) {
		claims.email = user.email;
		claims.email_verified = user.emailVerified;
	}
	if (scopes.includes("groups")) {
		claims.groups = user.role ? [user.role] : [];
	}
	return claims;
}

/** Splits a textarea of redirect URIs (one per line, or comma-separated) into a clean, de-duplicated list. */
export function parseRedirectUris(raw: string): string[] {
	return [
		...new Set(
			raw
				.split(/[\n,]/)
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
	email: "Your email address",
	groups: "Your role on this Homerun instance",
	offline_access: "Stay signed in without asking again",
	openid: "Confirm who you are",
	profile: "Your name and profile picture",
};

/** What each requested scope shares, in plain words, for the consent screen. Unknown scopes are listed by name. */
export function describeScopes(scope: string | null): string[] {
	return (scope ?? "")
		.split(" ")
		.filter(Boolean)
		.map((entry) => SCOPE_DESCRIPTIONS[entry] ?? entry);
}

/**
 * `request` with its origin swapped for the dashboard's, keeping path, query,
 * method, headers and body. better-auth builds the discovery document's
 * endpoints from the request URL, which the server adapter pins to the
 * `ORIGIN` env var (the IP the installer detected), so without this an app
 * signing in through the domain is sent to the IP.
 */
export function rebaseOnOrigin(request: Request, origin: string): Request {
	const url = new URL(request.url);
	const target = new URL(origin);
	if (url.origin === target.origin) {
		return request;
	}
	return new Request(`${target.origin}${url.pathname}${url.search}`, request);
}
