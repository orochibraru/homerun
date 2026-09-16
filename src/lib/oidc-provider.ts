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
