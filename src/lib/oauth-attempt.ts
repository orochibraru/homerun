const KEY = "homerun:oauth-attempt";

/**
 * Records in sessionStorage which OAuth provider a sign-in was started with, so
 * the auth error page can name it after the redirect back.
 *
 * @returns false when sessionStorage is unavailable.
 */
export function rememberOauthAttempt(provider: string): boolean {
	try {
		sessionStorage.setItem(KEY, provider);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reads the OAuth provider stored by `rememberOauthAttempt`, or null when there
 * is none or sessionStorage is unavailable.
 */
export function lastOauthAttempt(): string | null {
	try {
		return sessionStorage.getItem(KEY);
	} catch {
		return null;
	}
}

/**
 * Removes the stored OAuth attempt from sessionStorage.
 *
 * @returns false when sessionStorage is unavailable.
 */
export function clearOauthAttempt(): boolean {
	try {
		sessionStorage.removeItem(KEY);
		return true;
	} catch {
		return false;
	}
}
