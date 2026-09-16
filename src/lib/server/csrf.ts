const FORM_CONTENT_TYPES = new Set([
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"text/plain",
	"application/x-sveltekit-formdata",
]);

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * SvelteKit's own cross-site form check (`csrf.checkOrigin`), reimplemented so
 * it can skip `exempt` paths: it runs before any hook, so it can't be turned
 * off per route, and it rejects the OAuth token, introspection and revocation
 * endpoints, which apps call from their own servers with a form body and no
 * `Origin` header. True when a browser form post from another origin (or with
 * no origin) should be refused. The origin counts as the same when it matches
 * `url.origin` or the request's own `Host` header: SvelteKit rewrites
 * `url.origin` to `ORIGIN`, so a form posted from the server's IP while
 * `ORIGIN` names a domain would otherwise be refused, which is how a mistyped
 * Dashboard URL locks you out.
 */
export function isForbiddenCrossSiteForm(
	request: Pick<Request, "headers" | "method">,
	url: URL,
	exempt: (pathname: string) => boolean,
): boolean {
	if (!MUTATING_METHODS.has(request.method) || exempt(url.pathname)) {
		return false;
	}
	const mediaType = request.headers
		.get("content-type")
		?.split(";")[0]
		?.trim()
		.toLowerCase();
	if (!(mediaType && FORM_CONTENT_TYPES.has(mediaType))) {
		return false;
	}
	const origin = request.headers.get("origin");
	if (!origin) {
		return true;
	}
	if (origin === url.origin) {
		return false;
	}
	try {
		return new URL(origin).host !== request.headers.get("host");
	} catch {
		return true;
	}
}
