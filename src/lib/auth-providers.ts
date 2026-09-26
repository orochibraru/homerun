export const PASSWORD_METHOD = "password";

export const EMAIL_OTP_METHOD = "email-otp";
export const MAGIC_LINK_METHOD = "magic-link";

export const OAUTH_METHOD_PREFIX = "oauth:";

export interface EmailSignIn {
	emailOtp: boolean;
	magicLink: boolean;
}

export const NO_EMAIL_SIGN_IN: EmailSignIn = {
	emailOtp: false,
	magicLink: false,
};

export interface OauthPreset {
	docsUrl: string;
	id: string;
	label: string;
	pkce: boolean;
	scopes: string[];
	template: string;
	templateHint: string;
}

export const OAUTH_PRESETS: OauthPreset[] = [
	{
		docsUrl: "https://pocket-id.org/docs/client-examples/oauth2-proxy",
		id: "pocket-id",
		label: "Pocket ID",
		pkce: true,
		scopes: ["openid", "profile", "email", "groups"],
		template: "https://{host}/.well-known/openid-configuration",
		templateHint: "{host} is your Pocket ID hostname.",
	},
	{
		docsUrl: "https://www.keycloak.org/securing-apps/oidc-layers#_endpoints_2",
		id: "keycloak",
		label: "Keycloak",
		pkce: true,
		scopes: ["openid", "profile", "email"],
		template: "https://{host}/realms/{realm}/.well-known/openid-configuration",
		templateHint: "{host} is your Keycloak hostname, {realm} the realm name.",
	},
	{
		docsUrl:
			"https://www.authelia.com/integration/openid-connect/introduction/",
		id: "authelia",
		label: "Authelia",
		pkce: true,
		scopes: ["openid", "profile", "email", "groups"],
		template: "https://{host}/.well-known/openid-configuration",
		templateHint: "{host} is your Authelia hostname.",
	},
	{
		docsUrl: "https://openid.logto.io",
		id: "logto",
		label: "Logto",
		pkce: true,
		scopes: ["openid", "profile", "email"],
		template: "https://{host}/oidc/.well-known/openid-configuration",
		templateHint: "{host} is your Logto endpoint hostname.",
	},
	{
		docsUrl: "https://docs.goauthentik.io/add-secure-apps/providers/oauth2/",
		id: "authentik",
		label: "Authentik",
		pkce: true,
		scopes: ["openid", "profile", "email"],
		template:
			"https://{host}/application/o/{slug}/.well-known/openid-configuration",
		templateHint:
			"{host} is your Authentik hostname, {slug} the provider's application slug.",
	},
	{
		docsUrl: "https://zitadel.com/docs/guides/integrate/login/oidc/login-users",
		id: "zitadel",
		label: "Zitadel",
		pkce: true,
		scopes: ["openid", "profile", "email"],
		template: "https://{host}/.well-known/openid-configuration",
		templateHint: "{host} is your Zitadel instance hostname.",
	},
	{
		docsUrl: "https://kanidm.github.io/kanidm/stable/integrations/oauth2.html",
		id: "kanidm",
		label: "Kanidm",
		pkce: true,
		scopes: ["openid", "profile", "email", "groups"],
		template:
			"https://{host}/oauth2/openid/{clientId}/.well-known/openid-configuration",
		templateHint:
			"{host} is your Kanidm hostname, {clientId} the OAuth2 client name.",
	},
];

/** Builds the sign-in method id (`oauth:<name>`) for a configured OAuth provider. */
export function oauthMethod(providerName: string): string {
	return `${OAUTH_METHOD_PREFIX}${providerName}`;
}

/** Whether a sign-in method id refers to an OAuth provider rather than password. */
export function isOauthMethod(method: string): boolean {
	return method.startsWith(OAUTH_METHOD_PREFIX);
}

/**
 * Extracts the provider name from an `oauth:<name>` method id, or null for a
 * non-OAuth method.
 */
export function oauthProviderName(method: string): string | null {
	return isOauthMethod(method)
		? method.slice(OAUTH_METHOD_PREFIX.length)
		: null;
}

/**
 * Whether `method` can be used to sign in on this instance right now: the
 * built-in password always, an OAuth provider while it's enabled, an emailed
 * code or link while that method is switched on and SMTP works. Anything else
 * (a deleted provider, a typo) is not.
 */
export function signInMethodAvailable(
	method: string,
	available: { email: EmailSignIn; oauthProviders: Set<string> },
): boolean {
	if (method === PASSWORD_METHOD) {
		return true;
	}
	if (method === EMAIL_OTP_METHOD) {
		return available.email.emailOtp;
	}
	if (method === MAGIC_LINK_METHOD) {
		return available.email.magicLink;
	}
	const provider = oauthProviderName(method);
	return provider !== null && available.oauthProviders.has(provider);
}

/**
 * Whether a login wall's allowed methods let any account through on the
 * strength of its email address alone: an emailed code or link proves the
 * mailbox, and every account has one, so no linked identity is needed. Only
 * counts a method that's available right now.
 */
export function acceptsEmailSignIn(
	methods: string[],
	email: EmailSignIn,
): boolean {
	return (
		(email.emailOtp && methods.includes(EMAIL_OTP_METHOD)) ||
		(email.magicLink && methods.includes(MAGIC_LINK_METHOD))
	);
}

/**
 * Maps a sign-in method id to the `providerId` better-auth stores on the account
 * row: `credential` for password, the bare provider name for OAuth.
 */
export function accountProviderIdFor(method: string): string {
	return method === PASSWORD_METHOD
		? "credential"
		: (oauthProviderName(method) ?? method);
}

/**
 * Inverse of `accountProviderIdFor`: maps a better-auth account `providerId` back
 * to a sign-in method id.
 */
export function methodForAccountProviderId(providerId: string): string {
	return providerId === "credential"
		? PASSWORD_METHOD
		: oauthMethod(providerId);
}

/**
 * Case-insensitively matches an email against an allow-list pattern, either an
 * exact address or a `*@domain` wildcard. Blank inputs never match.
 */
export function emailMatchesPattern(email: string, pattern: string): boolean {
	const normalizedEmail = email.trim().toLowerCase();
	const normalizedPattern = pattern.trim().toLowerCase();
	if (!(normalizedEmail && normalizedPattern)) {
		return false;
	}
	if (normalizedPattern.startsWith("*@")) {
		return normalizedEmail.endsWith(normalizedPattern.slice(1));
	}
	return normalizedEmail === normalizedPattern;
}

/**
 * Picks the token endpoint client authentication style from the methods an OIDC
 * discovery document advertises, preferring `client_secret_basic`.
 *
 * @returns null when neither secret-based method is advertised.
 */
export function resolveAdvertisedTokenAuth(
	methods: string[],
): "basic" | "post" | null {
	if (methods.includes("client_secret_basic")) {
		return "basic";
	}
	if (methods.includes("client_secret_post")) {
		return "post";
	}
	return null;
}
