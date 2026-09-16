export const REDIRECT_TO_PARAM = "redirectTo";

/**
 * The same-origin path a sign-in page may send the visitor to afterwards, or
 * null when `candidate` is missing or could leave this origin (an absolute
 * URL, a protocol-relative `//host`, or a backslash browsers treat as one).
 * Keeps `?redirectTo=` from being an open redirect.
 */
export function safeRedirectTarget(candidate: string | null): string | null {
	if (!candidate?.startsWith("/")) {
		return null;
	}
	if (candidate.startsWith("//") || candidate.includes("\\")) {
		return null;
	}
	try {
		const parsed = new URL(candidate, "http://homerun.invalid");
		if (parsed.origin !== "http://homerun.invalid") {
			return null;
		}
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return null;
	}
}

/** The sign-in page URL that returns the visitor to `target` once they're signed in. */
export function signInUrlFor(signInPath: string, target: string): string {
	return `${signInPath}?${new URLSearchParams({ [REDIRECT_TO_PARAM]: target })}`;
}
