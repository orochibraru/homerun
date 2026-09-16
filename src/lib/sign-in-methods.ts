export const PASSWORD_SIGN_IN = "password";
export const PASSKEY_SIGN_IN = "passkey";

export interface SignInMethodSplit {
	others: string[];
	primary: string[];
}

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
