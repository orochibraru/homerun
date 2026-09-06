import type { OauthProviderInput } from "$lib/dto/instance-settings-dto";
import type { OauthTokenAuthMethod } from "$lib/server/db/schema";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ParsedOauthProvider {
	error: string | null;
	input: OauthProviderInput | null;
}

interface DiscoveryResult {
	error: string | null;
	tokenAuthMethods: string[];
}

function parseTokenAuthMethod(raw: string | null): OauthTokenAuthMethod {
	return raw === "basic" || raw === "post" ? raw : "auto";
}

async function inspectDiscoveryUrl(url: string): Promise<DiscoveryResult> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) {
			return { error: `Returned HTTP ${res.status}.`, tokenAuthMethods: [] };
		}
		const body = (await res.json().catch(() => null)) as {
			issuer?: string;
			token_endpoint_auth_methods_supported?: unknown;
		} | null;
		if (!body?.issuer) {
			return {
				error:
					'Didn\'t return a valid OpenID discovery document (missing "issuer").',
				tokenAuthMethods: [],
			};
		}
		const advertised = body.token_endpoint_auth_methods_supported;
		return {
			error: null,
			tokenAuthMethods: Array.isArray(advertised)
				? advertised.filter((m): m is string => typeof m === "string")
				: [],
		};
	} catch (error) {
		return {
			error:
				error instanceof Error
					? `Couldn't be reached: ${error.message}`
					: "Couldn't be reached.",
			tokenAuthMethods: [],
		};
	}
}

function text(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === "string" ? value.trim() : "";
}

export async function parseOauthProviderForm(
	formData: FormData,
	takenNames: string[],
): Promise<ParsedOauthProvider> {
	const name = text(formData, "name").toLowerCase();
	const label = text(formData, "label");
	const clientId = text(formData, "clientId");
	const discoveryUrl = text(formData, "discoveryUrl");

	if (!name) {
		return { error: "Give the provider an id.", input: null };
	}
	if (!NAME_RE.test(name)) {
		return {
			error:
				'The provider id can only contain lowercase letters, digits and hyphens, and must start with a letter or digit : it appears in the redirect URI (for example "pocket-id").',
			input: null,
		};
	}
	if (takenNames.includes(name)) {
		return {
			error: `Another provider already uses the id "${name}".`,
			input: null,
		};
	}
	if (!clientId) {
		return { error: "The client id is required.", input: null };
	}
	if (!discoveryUrl) {
		return { error: "The discovery URL is required.", input: null };
	}

	const discovery = await inspectDiscoveryUrl(discoveryUrl);
	if (discovery.error) {
		return {
			error: `That discovery URL is invalid: ${discovery.error}`,
			input: null,
		};
	}

	return {
		error: null,
		input: {
			clientId,
			clientSecret: text(formData, "clientSecret") || undefined,
			discoveredTokenAuth: discovery.tokenAuthMethods,
			discoveryUrl,
			enabled: formData.get("enabled") === "on",
			label: label || name,
			name,
			pkce: formData.get("pkce") === "on",
			scopes: text(formData, "scopes")
				.split(",")
				.map((scope) => scope.trim())
				.filter(Boolean),
			signOutOfProvider: formData.get("signOutOfProvider") === "on",
			tokenAuthMethod: parseTokenAuthMethod(
				formData.get("tokenAuthMethod") as string | null,
			),
		},
	};
}
