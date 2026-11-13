import type { GitProviderKind } from "#lib/server/db/schema.js";

export interface RepoIdentity {
	fullName: string;
	id: string;
}

/** The API path that reads a repository by its provider id, which survives a rename of the repository or of its owner. */
export function repoByIdPath(kind: GitProviderKind, id: string): string {
	switch (kind) {
		case "github":
		case "gitea":
			return `/repositories/${encodeURIComponent(id)}`;
		case "gitlab":
			return `/projects/${encodeURIComponent(id)}`;
		case "bitbucket":
			return `/repositories/${id.split("/").map(encodeURIComponent).join("/")}`;
		default: {
			const exhaustive: never = kind;
			throw new Error(`Unknown git provider kind: ${exhaustive}`);
		}
	}
}

/** The API path that reads a repository by its `owner/name` path. */
export function repoByNamePath(
	kind: GitProviderKind,
	fullName: string,
): string {
	switch (kind) {
		case "github":
		case "gitea":
			return `/repos/${fullName}`;
		case "gitlab":
			return `/projects/${encodeURIComponent(fullName)}`;
		case "bitbucket":
			return `/repositories/${fullName}`;
		default: {
			const exhaustive: never = kind;
			throw new Error(`Unknown git provider kind: ${exhaustive}`);
		}
	}
}

/**
 * A provider's answer for one repository, as its id and current path.
 * Bitbucket's id is `{workspace uuid}/{repo uuid}`, since it reads a
 * repository by UUID only under its workspace's.
 *
 * @throws When the answer carries no id or path.
 */
export function parseRepoIdentity(
	kind: GitProviderKind,
	body: unknown,
): RepoIdentity {
	const repo = body as {
		full_name?: string;
		id?: number | string;
		path_with_namespace?: string;
		uuid?: string;
		workspace?: { uuid?: string };
	};
	const fullName =
		kind === "gitlab" ? repo.path_with_namespace : repo.full_name;
	const id =
		kind === "bitbucket"
			? repo.workspace?.uuid && repo.uuid
				? `${repo.workspace.uuid}/${repo.uuid}`
				: null
			: repo.id === undefined
				? null
				: String(repo.id);
	if (!(fullName && id)) {
		throw new Error("The provider's answer has no repository id or path.");
	}
	return { fullName, id };
}

/** The last segment of a repository path, its name without the owner or group. */
export function repoName(fullName: string): string {
	return fullName.split("/").at(-1) ?? fullName;
}

/**
 * `url` with the repository path `from` replaced by `to`, for a clone URL
 * (https or `git@host:owner/name.git`) or a web URL. The path matches
 * whatever its case, as providers treat it; a URL without it is returned
 * as is.
 */
export function renameRepoInUrl(url: string, from: string, to: string): string {
	const escaped = from.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	return url.replace(
		new RegExp(String.raw`([/:])${escaped}(?=\.git$|/|$)`, "i"),
		`$1${to}`,
	);
}
