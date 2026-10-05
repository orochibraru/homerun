import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { Logger } from "#lib/logger.js";
import type {
	GitProviderConfig,
	GitProviderKind,
} from "#lib/server/db/schema.js";

const logger = new Logger("GitProviders");

const OAUTH_KINDS = new Set<string>(["gitlab", "gitea", "bitbucket"]);

/** A provider change refused for the caller's input; nothing was saved. */
export class GitProviderConfigError extends Error {}

export interface GitProviderSettings {
	baseUrl?: string | null;
	clientId?: string;
	clientSecret?: string;
	enabled?: boolean;
	kind?: string | null;
	name?: string;
}

/** A configured provider as `updateGitProviders` takes it back: its secret stays put. */
function asInput(provider: GitProviderConfig) {
	return {
		baseUrl: provider.baseUrl,
		clientId: provider.clientId,
		enabled: provider.enabled,
		id: provider.id,
		kind: provider.kind,
		name: provider.name,
	};
}

/**
 * The git providers configured on the instance (OAuth apps users connect
 * their accounts through), shared by the Git Providers page and the REST
 * API. GitHub Apps come from the manifest flow, not from here.
 */
class GitProviderConfigServiceClass {
	/** Every configured provider. */
	async list(): Promise<GitProviderConfig[]> {
		return (await InstanceSettingsDTO.get()).gitProviders;
	}

	/** One configured provider, null when there's none with that id. */
	async get(id: string): Promise<GitProviderConfig | null> {
		return (await this.list()).find((provider) => provider.id === id) ?? null;
	}

	/**
	 * Adds a GitLab, Gitea or Bitbucket OAuth app.
	 *
	 * @throws {GitProviderConfigError} When a field is missing or invalid.
	 */
	async add(
		input: GitProviderSettings,
		userId: string,
	): Promise<GitProviderConfig> {
		const kind = input.kind ?? "";
		if (!OAUTH_KINDS.has(kind)) {
			throw new GitProviderConfigError("Choose a provider.");
		}
		const provider = this.#checked({
			...input,
			enabled: input.enabled ?? true,
		});
		if (!provider.clientSecret) {
			throw new GitProviderConfigError("Client ID and secret are required.");
		}
		const id = crypto.randomUUID();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateGitProviders([
			...settings.gitProviders.map(asInput),
			{ ...provider, id, kind: kind as GitProviderKind },
		]);
		logger.info(
			`Git provider added: kind=${kind} name=${provider.name} by=${userId}`,
		);
		return (await this.get(id)) as GitProviderConfig;
	}

	/**
	 * Changes a provider's fields; a missing secret keeps the stored one.
	 *
	 * @throws {GitProviderConfigError} When it doesn't exist or a field is
	 *   invalid.
	 */
	async update(
		id: string,
		input: GitProviderSettings,
	): Promise<GitProviderConfig> {
		const settings = await InstanceSettingsDTO.get();
		const current = settings.gitProviders.find(
			(provider) => provider.id === id,
		);
		if (!current) {
			throw new GitProviderConfigError("That provider doesn't exist.");
		}
		const next = this.#checked({ ...asInput(current), ...input });
		await settings.updateGitProviders(
			settings.gitProviders.map((provider) =>
				provider.id === id
					? { ...next, id, kind: current.kind }
					: asInput(provider),
			),
		);
		return (await this.get(id)) as GitProviderConfig;
	}

	/** Removes a provider; its users' connections stop working. */
	async remove(id: string, userId: string): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		await settings.updateGitProviders(
			settings.gitProviders
				.filter((provider) => provider.id !== id)
				.map(asInput),
		);
		logger.info(`Git provider deleted: id=${id} by=${userId}`);
	}

	/** The provider's trimmed fields, or the first one missing. */
	#checked(input: GitProviderSettings) {
		const name = input.name?.trim() ?? "";
		const clientId = input.clientId?.trim() ?? "";
		const baseUrl = input.baseUrl?.trim() || null;
		if (!name) {
			throw new GitProviderConfigError("Name is required.");
		}
		if (!clientId) {
			throw new GitProviderConfigError("Client ID and secret are required.");
		}
		if (input.kind === "gitea" && !baseUrl) {
			throw new GitProviderConfigError(
				"Gitea providers need a base URL (self-hosted only).",
			);
		}
		return {
			baseUrl,
			clientId,
			clientSecret: input.clientSecret?.trim() || undefined,
			enabled: input.enabled ?? true,
			name,
		};
	}
}

export const GitProviderConfigService = new GitProviderConfigServiceClass();
