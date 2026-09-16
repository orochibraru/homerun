export const PASSWORD_SIGN_IN = "password";
export const PASSKEY_SIGN_IN = "passkey";

export interface SignInMethodSplit {
	others: string[];
	primary: string[];
}

/**
 * Splits the available sign-in methods into the preferred ones shown prominently
 * and the rest. When none of the preferred methods is available, every method is
 * treated as primary.
 */
export function splitSignInMethods(
	available: string[],
	preferred: string[],
): SignInMethodSplit {
	const primary = available.filter((method) => preferred.includes(method));
	if (primary.length === 0) {
		return { others: [], primary: available };
	}
	return {
		others: available.filter((method) => !primary.includes(method)),
		primary,
	};
}
