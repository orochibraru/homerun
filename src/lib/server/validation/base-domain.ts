/** A bare hostname : letters/digits/hyphens/dots, optional :port, no scheme or path. */
const BARE_HOSTNAME_RE =
	/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::\d{1,5})?$/;

/**
 * Normalizes a "Base domain" field into a bare hostname, or returns null if
 * it isn't one. Real user report this fixes: pasting a full URL (e.g.
 * "https://app.homerun.orb.local") used to get stored verbatim, silently
 * breaking every Traefik Host() rule built from it (labels.ts interpolates
 * config.baseDomain straight into `Host(\`${host}.${baseDomain}\`)`, so a
 * scheme in there produces an invalid rule, not an error). A URL-shaped
 * input is now forgiven (the hostname is pulled back out) rather than
 * silently corrupting routing; anything else that still isn't a bare
 * hostname is rejected with a clear error instead of stored as-is.
 *
 * Shared by settings/+page.server.ts and onboarding/+page.server.ts : both
 * post the same "Base domain" field through the same `updateCore()`, and an
 * origin derived from it the same way (base domain + a "Use HTTPS"
 * checkbox, see both action's own comment), so the normalization has to
 * stay identical between the two rather than drift.
 */
export function normalizeBaseDomain(raw: string): string | null {
	let candidate = raw.trim();
	if (candidate.includes("://")) {
		try {
			candidate = new URL(candidate).host;
		} catch {
			return null;
		}
	} else {
		// Tolerate a bare "host/path" typo the same way.
		candidate = candidate.split("/")[0] ?? candidate;
	}
	return BARE_HOSTNAME_RE.test(candidate) ? candidate : null;
}
