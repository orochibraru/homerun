const MANIFEST_FILES = new Set([
	"manifest.json",
	"manifest.webmanifest",
	"site.webmanifest",
]);

/**
 * What the login wall does with a request that has no valid session: let a
 * web app manifest through (browsers fetch it without cookies, so it could
 * never pass, and it only holds the app's name, icons and colors), answer 401
 * to anything that isn't a page navigation (a fetch, script or image can't
 * follow a cross-origin redirect to a sign-in page, it only trips CORS), and
 * redirect the rest to sign in. A request without `Sec-Fetch-*` headers
 * counts as a navigation.
 */
export function gateChallengeKind(
	headers: Headers,
	path: string,
): "allow" | "deny" | "redirect" {
	const file = path.slice(path.lastIndexOf("/") + 1);
	if (
		headers.get("sec-fetch-dest") === "manifest" &&
		MANIFEST_FILES.has(file)
	) {
		return "allow";
	}
	const mode = headers.get("sec-fetch-mode");
	return mode && mode !== "navigate" ? "deny" : "redirect";
}
