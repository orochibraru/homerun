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

export function passkeyRpId(
	origin: string | null | undefined,
): string | undefined {
	if (!(origin && URL.canParse(origin))) {
		return;
	}
	return new URL(origin).hostname || undefined;
}

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

export function totpSecretFromUri(uri: string): string | null {
	try {
		return new URL(uri).searchParams.get("secret");
	} catch {
		return null;
	}
}
