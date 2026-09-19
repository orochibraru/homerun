const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/**
 * Whether a git ref is a full 40-character commit SHA rather than a branch or
 * tag name. Only full SHAs count: a remote can only be fetched by a full one.
 */
export function isCommitSha(ref: string | null | undefined): boolean {
	return !!ref && COMMIT_SHA.test(ref.trim());
}

/**
 * What a branch poll does with the head it just read: `baseline` records the
 * first head seen without deploying (nothing to compare to yet), `deploy`
 * means the branch moved past the last head a push or poll reported, and
 * `unchanged` means it didn't.
 */
export function pollOutcome(
	lastSeen: string | null,
	head: string,
): "baseline" | "deploy" | "unchanged" {
	if (!lastSeen) {
		return "baseline";
	}
	return lastSeen.toLowerCase() === head.toLowerCase() ? "unchanged" : "deploy";
}
