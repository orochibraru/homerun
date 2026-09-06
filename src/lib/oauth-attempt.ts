const KEY = "homerun:oauth-attempt";

export function rememberOauthAttempt(provider: string): boolean {
	try {
		sessionStorage.setItem(KEY, provider);
		return true;
	} catch {
		return false;
	}
}

export function lastOauthAttempt(): string | null {
	try {
		return sessionStorage.getItem(KEY);
	} catch {
		return null;
	}
}

export function clearOauthAttempt(): boolean {
	try {
		sessionStorage.removeItem(KEY);
		return true;
	} catch {
		return false;
	}
}
