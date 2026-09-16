import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { hostOf, providerForGitUrl } from "$lib/git-clone-url";
import {
	type CheckTarget,
	inferProviderKind,
	providerApiBase,
	repoPathFromGitUrl,
	StatusCheckClient,
} from "$lib/status-checks";
import { decryptSecret } from "./secrets.ts";

function embeddedToken(gitUrl: string): string | null {
	try {
		const url = new URL(gitUrl);
		const token = decodeURIComponent(url.password || url.username);
		return token || null;
	} catch {
		return null;
	}
}

class StatusCheckServiceClass {
	/**
	 * Resolves what a status check needs to call a git provider's API for
	 * `gitUrl`: the provider kind (from a configured Git Provider connection
	 * or inferred from the URL), the repo path, and an access token, preferring
	 * one embedded in the URL itself over the user's stored connection.
	 * @throws When no provider kind can be resolved, or the repo path can't
	 * be read from the URL.
	 */
	async targetFor(gitUrl: string, userId: string): Promise<CheckTarget> {
		const settings = await InstanceSettingsDTO.get();
		const provider = providerForGitUrl(
			gitUrl,
			settings.gitProviders.filter((p) => p.enabled),
		);
		const kind = provider?.kind ?? inferProviderKind(gitUrl);
		if (!kind) {
			throw new Error(
				`Status checks need a git provider API, and ${hostOf(gitUrl) ?? gitUrl} isn't a configured provider. Add it under Git Providers.`,
			);
		}
		const repo = repoPathFromGitUrl(gitUrl, provider?.baseUrl ?? null);
		if (!repo) {
			throw new Error(`Couldn't read the repository path from ${gitUrl}.`);
		}
		const connection = provider
			? await GitConnectionDTO.getForUserAndProvider(userId, provider.id)
			: null;
		const token =
			embeddedToken(gitUrl) ??
			(connection ? decryptSecret(connection.accessTokenEnc) : null);
		return {
			api: providerApiBase(kind, provider?.baseUrl ?? null),
			kind,
			repo,
			token,
		};
	}

	/** A `StatusCheckClient` wired up for `gitUrl`, see `targetFor`. */
	async clientFor(gitUrl: string, userId: string): Promise<StatusCheckClient> {
		return new StatusCheckClient(await this.targetFor(gitUrl, userId));
	}

	/** The required-status-check names reported for `gitRef` by the repo's git provider. */
	async checkNames(
		gitUrl: string,
		gitRef: string,
		userId: string,
	): Promise<string[]> {
		const client = await this.clientFor(gitUrl, userId);
		return await client.checkNames(gitRef);
	}
}

export const StatusCheckService = new StatusCheckServiceClass();
