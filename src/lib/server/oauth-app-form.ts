import type { EnvironmentInput } from "$lib/dto/oauth-client-environment-dto";
import { callbackUrlProblem, originProblem } from "$lib/oidc-provider";
import { checkbox } from "$lib/server/validation/instance-settings-form";
import type {
	OauthAppInput,
	OauthAppSettings,
	SecretAuthMethod,
} from "$lib/services/oauth-app.service";

type Parsed<T> = { error: string; input: null } | { error: null; input: T };

const ENVIRONMENT_NAME = /^[\w .-]{1,32}$/;

/** The non-empty, trimmed, de-duplicated values of a repeated form field. */
function list(formData: FormData, name: string): string[] {
	return [
		...new Set(
			formData
				.getAll(name)
				.map((value) => String(value).trim())
				.filter(Boolean),
		),
	];
}

/**
 * Reads the app-wide settings: a name, the consent, logout and PKCE options
 * and how the secret is sent. `requirePkce` and `tokenAuthMethod` only mean
 * something for a confidential app.
 */
export function parseOauthAppSettings(
	formData: FormData,
): Parsed<
	OauthAppSettings & { requirePkce: boolean; tokenAuthMethod: SecretAuthMethod }
> {
	const name = String(formData.get("name") ?? "").trim();
	if (!name) {
		return { error: "Give the app a name.", input: null };
	}
	return {
		error: null,
		input: {
			enableEndSession: checkbox(formData, "enableEndSession"),
			name,
			requirePkce: checkbox(formData, "requirePkce"),
			skipConsent: checkbox(formData, "skipConsent"),
			tokenAuthMethod:
				formData.get("tokenAuthMethod") === "client_secret_post"
					? "client_secret_post"
					: "client_secret_basic",
		},
	};
}

/**
 * Reads an environment: its name, localhost switch, callback URLs (at least
 * one, https, loopback only where localhost is allowed) and authorized
 * origins, normalized without a trailing slash.
 */
export function parseEnvironmentForm(
	formData: FormData,
): Parsed<EnvironmentInput> {
	const name = String(formData.get("environmentName") ?? "").trim();
	if (!ENVIRONMENT_NAME.test(name)) {
		return {
			error:
				"Name the environment with up to 32 letters, digits, spaces, dots, dashes or underscores.",
			input: null,
		};
	}
	const allowLocalhost = checkbox(formData, "allowLocalhost");
	const redirectUris = list(formData, "redirectUris");
	if (redirectUris.length === 0) {
		return {
			error: "Add at least one callback URL, from the app's own OIDC settings.",
			input: null,
		};
	}
	for (const uri of redirectUris) {
		const problem = callbackUrlProblem(uri, allowLocalhost);
		if (problem) {
			return { error: `${uri}: ${problem}`, input: null };
		}
	}
	const allowedOrigins = list(formData, "allowedOrigins").map((origin) =>
		origin.replace(/\/+$/, ""),
	);
	for (const origin of allowedOrigins) {
		const problem = originProblem(origin, allowLocalhost);
		if (problem) {
			return { error: `${origin}: ${problem}`, input: null };
		}
	}
	return {
		error: null,
		input: {
			allowedOrigins: [...new Set(allowedOrigins)],
			allowLocalhost,
			name,
			redirectUris,
		},
	};
}

/** Reads the registration form: the app's settings, its client type and its first environment. */
export function parseOauthAppForm(formData: FormData): Parsed<OauthAppInput> {
	const settings = parseOauthAppSettings(formData);
	if (!settings.input) {
		return settings;
	}
	const environment = parseEnvironmentForm(formData);
	if (!environment.input) {
		return environment;
	}
	return {
		error: null,
		input: {
			...settings.input,
			confidential: formData.get("clientType") !== "public",
			environment: environment.input,
		},
	};
}
