export interface SecurityPolicy {
	requirePasskey: boolean;
	requireTwoFactor: boolean;
}

export interface UserSecurityState {
	passkeyCount: number;
	twoFactorEnabled: boolean;
}

export type SecurityRequirement = "passkey" | "twoFactor";

export const SECURITY_SETUP_PATH = "/security-setup";

/**
 * Lists the instance-wide security requirements (2FA, passkey) the user hasn't
 * satisfied yet, used to gate them onto the security setup page.
 */
export function unmetSecurityRequirements(
	policy: SecurityPolicy,
	state: UserSecurityState,
): SecurityRequirement[] {
	const unmet: SecurityRequirement[] = [];
	if (policy.requireTwoFactor && !state.twoFactorEnabled) {
		unmet.push("twoFactor");
	}
	if (policy.requirePasskey && state.passkeyCount === 0) {
		unmet.push("passkey");
	}
	return unmet;
}

/**
 * Derives the WebAuthn relying party id (the hostname) from a configured origin.
 *
 * @returns undefined when the origin is missing or not a valid URL.
 */
export function passkeyRpId(
	origin: string | null | undefined,
): string | undefined {
	if (!(origin && URL.canParse(origin))) {
		return;
	}
	return new URL(origin).hostname || undefined;
}

/**
 * Whether passkeys can work in the browser's current origin, i.e. its hostname
 * equals or is a subdomain of the relying party id derived from the configured
 * origin (`localhost` when none is configured).
 */
export function passkeyUsableOn(
	browserOrigin: string,
	configuredOrigin: string | null | undefined,
): boolean {
	if (!URL.canParse(browserOrigin)) {
		return false;
	}
	const host = new URL(browserOrigin).hostname;
	const rpId = passkeyRpId(configuredOrigin) ?? "localhost";
	return host === rpId || host.endsWith(`.${rpId}`);
}

/**
 * Sanitises a post-sign-in redirect target: only same-origin absolute paths are
 * kept, protocol-relative paths and the security setup page fall back to `/`.
 */
export function safeNextPath(next: string | null | undefined): string {
	if (
		!next?.startsWith("/") ||
		next.startsWith("//") ||
		next.startsWith("/\\")
	) {
		return "/";
	}
	if (next.startsWith(SECURITY_SETUP_PATH)) {
		return "/";
	}
	return next;
}

/**
 * Extracts the base32 secret from an `otpauth://` URI so it can be shown for
 * manual entry, or null when the URI can't be parsed.
 */
export function totpSecretFromUri(uri: string): string | null {
	try {
		return new URL(uri).searchParams.get("secret");
	} catch {
		return null;
	}
}
