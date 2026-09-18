export interface GithubAppRegistration {
	action: string;
	manifest: string;
}

export interface GithubAppCredentials {
	clientId: string;
	clientSecret: string;
	htmlUrl: string;
	name: string;
}

/**
 * Builds the GitHub App manifest registration for a provider that doesn't exist
 * yet: the form target on github.com (a personal account, or `org`'s settings)
 * carrying the signed `state`, and the manifest JSON. GitHub sends the admin
 * back to the provider's `github-app` route, and the app's OAuth callback is the
 * provider's usual `callback` route, so connecting afterwards is the same flow
 * as any other provider.
 */
export function githubAppRegistration(input: {
	name: string;
	org: string | null;
	origin: string;
	providerId: string;
	state: string;
}): GithubAppRegistration {
	const base = `${input.origin}/api/v1/git-providers/${input.providerId}`;
	const settings = input.org
		? `https://github.com/organizations/${encodeURIComponent(input.org)}/settings/apps/new`
		: "https://github.com/settings/apps/new";
	const manifest = {
		callback_urls: [`${base}/callback`],
		default_events: [],
		default_permissions: {
			checks: "read",
			contents: "read",
			metadata: "read",
			repository_hooks: "write",
			statuses: "read",
		},
		name: input.name,
		public: false,
		redirect_url: `${base}/github-app`,
		setup_url: `${input.origin}/git-providers`,
		url: input.origin,
	};
	return {
		action: `${settings}?state=${encodeURIComponent(input.state)}`,
		manifest: JSON.stringify(manifest),
	};
}

/**
 * Trades the one-time code GitHub hands back after an app is created from a
 * manifest for that app's OAuth credentials. The code works once, within an
 * hour. Throws when GitHub refuses it.
 */
export async function convertGithubAppManifest(
	code: string,
): Promise<GithubAppCredentials> {
	const res = await fetch(
		`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
		{ headers: { Accept: "application/vnd.github+json" }, method: "POST" },
	);
	if (!res.ok) {
		throw new Error(
			`GitHub refused the app manifest code: ${res.status} ${await res.text()}`,
		);
	}
	const body = (await res.json()) as {
		client_id: string;
		client_secret: string;
		html_url: string;
		name: string;
	};
	return {
		clientId: body.client_id,
		clientSecret: body.client_secret,
		htmlUrl: body.html_url,
		name: body.name,
	};
}
