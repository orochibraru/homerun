const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/**
 * Whether a git ref is a full 40-character commit SHA rather than a branch or
 * tag name. Only full SHAs count: a remote can only be fetched by a full one.
 */
export function isCommitSha(ref: string | null | undefined): boolean {
	return !!ref && COMMIT_SHA.test(ref.trim());
}

/**
 * The `git` argv lists that put `ref` of `cloneUrl` into `repoDir`, run in
 * order. A branch or tag is one shallow single-branch clone; a commit SHA,
 * which `clone --branch` can't take, is an init plus a shallow fetch of that
 * exact commit and a detached checkout of it.
 */
export function gitCheckoutSteps(
	cloneUrl: string,
	ref: string,
	repoDir: string,
): string[][] {
	if (!isCommitSha(ref)) {
		return [
			[
				"clone",
				"--depth",
				"1",
				"--branch",
				ref,
				"--single-branch",
				cloneUrl,
				repoDir,
			],
		];
	}
	const sha = ref.trim().toLowerCase();
	return [
		["init", "--quiet", repoDir],
		["-C", repoDir, "remote", "add", "origin", cloneUrl],
		["-C", repoDir, "fetch", "--depth", "1", "origin", sha],
		["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"],
	];
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
