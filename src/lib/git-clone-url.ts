export interface GitCredential {
	token: string;
	username: string;
}

/**
 * The lowercased host (with port) of a git URL, or null when it isn't a parseable
 * URL, e.g. an scp-style SSH remote.
 */
export function hostOf(gitUrl: string): string | null {
	try {
		return new URL(gitUrl).host.toLowerCase();
	} catch {
		return null;
	}
}

/** Whether a git URL already carries a username or password. */
export function hasEmbeddedCredentials(gitUrl: string): boolean {
	try {
		const url = new URL(gitUrl);
		return url.username !== "" || url.password !== "";
	} catch {
		return false;
	}
}

/**
 * Turns git's output from a failed clone into a user-facing message, replacing
 * authentication failures with a hint to connect a git provider or use a token
 * URL. Other output is returned unchanged.
 */
export function cloneFailureHint(gitUrl: string, output: string): string {
	if (
		/could not read (Username|Password)|Authentication failed|terminal prompts disabled/i.test(
			output,
		)
	) {
		return `Couldn't authenticate to ${hostOf(gitUrl) ?? gitUrl}. Connect that git provider under Git Providers, or put a token in the clone URL (https://<token>@host/...).`;
	}
	return output;
}

export interface ProviderHostInput {
	baseUrl: string | null;
	id: string;
	kind: "github" | "gitlab" | "gitea" | "bitbucket";
}

const DEFAULT_HOSTS: Record<string, string | null> = {
	bitbucket: "bitbucket.org",
	gitea: null,
	github: "github.com",
	gitlab: "gitlab.com",
};

/**
 * The host a git provider serves repositories from: its base URL's host for a
 * self-hosted instance, the public host for GitHub, GitLab and Bitbucket, or null
 * for a Gitea without a base URL.
 */
export function providerHost(provider: ProviderHostInput): string | null {
	if (provider.baseUrl) {
		return hostOf(provider.baseUrl);
	}
	return DEFAULT_HOSTS[provider.kind] ?? null;
}

/**
 * Finds the connected git provider whose host matches a repository URL, so its
 * credentials can be used for cloning and status checks.
 */
export function providerForGitUrl<T extends ProviderHostInput>(
	gitUrl: string,
	providers: T[],
): T | null {
	const host = hostOf(gitUrl);
	if (!host) {
		return null;
	}
	return providers.find((p) => providerHost(p) === host) ?? null;
}
