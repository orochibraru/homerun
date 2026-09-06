export const PASSWORD_METHOD = "password";

export const OAUTH_METHOD_PREFIX = "oauth:";

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

export function oauthMethod(providerName: string): string {
	return `${OAUTH_METHOD_PREFIX}${providerName}`;
}

export function isOauthMethod(method: string): boolean {
	return method.startsWith(OAUTH_METHOD_PREFIX);
}

export function oauthProviderName(method: string): string | null {
	return isOauthMethod(method)
		? method.slice(OAUTH_METHOD_PREFIX.length)
		: null;
}

export function accountProviderIdFor(method: string): string {
	return method === PASSWORD_METHOD
		? "credential"
		: (oauthProviderName(method) ?? method);
}

export function methodForAccountProviderId(providerId: string): string {
	return providerId === "credential"
		? PASSWORD_METHOD
		: oauthMethod(providerId);
}

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
