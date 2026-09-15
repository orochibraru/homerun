export interface GitCredential {
	token: string;
	username: string;
}

export function hostOf(gitUrl: string): string | null {
	try {
		return new URL(gitUrl).host.toLowerCase();
	} catch {
		return null;
	}
}

export function hasEmbeddedCredentials(gitUrl: string): boolean {
	try {
		const url = new URL(gitUrl);
		return url.username !== "" || url.password !== "";
	} catch {
		return false;
	}
}

export function authenticatedCloneUrl(
	gitUrl: string,
	credential: GitCredential | null,
): string {
	if (!credential || hasEmbeddedCredentials(gitUrl)) {
		return gitUrl;
	}
	let url: URL;
	try {
		url = new URL(gitUrl);
	} catch {
		return gitUrl;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return gitUrl;
	}
	url.username = encodeURIComponent(credential.username);
	url.password = encodeURIComponent(credential.token);
	return url.toString();
}

export function redactCloneUrl(gitUrl: string): string {
	try {
		const url = new URL(gitUrl);
		if (url.username || url.password) {
			url.username = "***";
			url.password = "";
		}
		return url.toString();
	} catch {
		return gitUrl;
	}
}

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

export function providerHost(provider: ProviderHostInput): string | null {
	if (provider.baseUrl) {
		return hostOf(provider.baseUrl);
	}
	return DEFAULT_HOSTS[provider.kind] ?? null;
}

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
