import { config } from "#lib/config.js";
import { GitConnectionDTO } from "#lib/dto/git-connection-dto.js";
import type { RepositoryDTO } from "#lib/dto/repository-dto.js";
import { verifyGitWebhook } from "#lib/git-webhooks.js";
import { Logger } from "#lib/logger.js";
import { isPipelineProvider } from "#lib/pipelines/providers.js";
import {
	isPipelineEvent,
	pipelineWebhookRequest,
	pipelineWebhookSecret,
	pipelineWebhookUrl,
} from "#lib/pipelines/webhooks.js";

import {
	enabledGitProvider,
	GitProviderService,
} from "./git-provider.service.ts";

const logger = new Logger("PipelineWebhook");

export interface PipelineWebhookDetails {
	error: string | null;
	registered: boolean;
	secret: string;
	url: string | null;
}

export type PipelineDeliveryResult =
	| { repo: RepositoryDTO; status: "sync" }
	| { reason: string; status: "ignored" }
	| { code: 401 | 404; reason: string; status: "rejected" };

/**
 * The CI webhook of a watched repository: registers it on the provider so
 * workflow runs and jobs (GitLab pipelines and jobs) trigger a sync right
 * away, removes it when the repository stops being watched, and verifies
 * deliveries with the same signature check as push-to-deploy. Polling stays
 * the fallback when the hook can't be registered or a delivery is lost.
 */
class PipelineWebhookServiceClass {
	/** The secret the repository's hook is signed with. */
	secret(repo: RepositoryDTO): string {
		return pipelineWebhookSecret(config.auth.secret, repo.id);
	}

	/**
	 * Registers the repository's CI webhook with its provider as the user
	 * who added it, recording the hook id, or why it couldn't be registered
	 * for the Settings tab. Never throws.
	 */
	async register(repo: RepositoryDTO): Promise<void> {
		const outcome = await this.#create(repo).catch((err: unknown) => {
			logger.warn(
				`Couldn't register the CI webhook: repository=${repo.id} ${repo.fullName}`,
				err,
			);
			return {
				error:
					err instanceof Error ? err.message : "Couldn't register the webhook.",
				hookId: null,
			};
		});
		await repo.update({
			webhookError: outcome.error,
			webhookId: outcome.hookId,
		});
		if (outcome.hookId) {
			logger.info(
				`Registered the CI webhook: repository=${repo.id} ${repo.fullName} hook=${outcome.hookId}`,
			);
		}
	}

	/** Creates the hook, or says why it can't be: no dashboard URL, provider gone, owner disconnected. */
	async #create(
		repo: RepositoryDTO,
	): Promise<{ error: string | null; hookId: string | null }> {
		if (!config.auth.origin) {
			return {
				error:
					"Set the Dashboard URL under Settings → General: it's the address the provider sends CI events to.",
				hookId: null,
			};
		}
		const provider = await enabledGitProvider(repo.providerId);
		if (!(provider && isPipelineProvider(provider.kind))) {
			return {
				error:
					"The git provider this repository lives on was removed or turned off.",
				hookId: null,
			};
		}
		const connection = await GitConnectionDTO.getForUserAndProvider(
			repo.userId,
			provider.id,
		);
		if (!connection) {
			return {
				error: `Whoever added this repository isn't connected to ${provider.name} any more.`,
				hookId: null,
			};
		}
		const url = pipelineWebhookUrl(config.auth.origin, repo.id);
		const hookId = await GitProviderService.registerWebhook(
			provider,
			connection,
			pipelineWebhookRequest(provider.kind, repo.fullName, {
				secret: this.secret(repo),
				url,
			}),
			url,
		);
		return { error: null, hookId };
	}

	/** Removes the repository's CI webhook from its provider, for a repository no longer watched. Never throws. */
	async remove(repo: RepositoryDTO): Promise<void> {
		const hookId = repo.toJSON().webhookId;
		const provider = hookId ? await enabledGitProvider(repo.providerId) : null;
		const connection = provider
			? await GitConnectionDTO.getForUserAndProvider(repo.userId, provider.id)
			: null;
		if (!(hookId && provider && connection)) {
			return;
		}
		await GitProviderService.deletePushWebhook(
			provider,
			connection,
			repo.fullName,
			hookId,
		).catch((err: unknown) => {
			logger.warn(
				`Couldn't remove the CI webhook: repository=${repo.id} hook=${hookId}`,
				err,
			);
		});
	}

	/** What the Settings tab shows about the hook: whether it's registered, why not, and the URL and secret to add it by hand. */
	describe(repo: RepositoryDTO): PipelineWebhookDetails {
		const row = repo.toJSON();
		return {
			error: row.webhookError,
			registered: !!row.webhookId,
			secret: this.secret(repo),
			url: config.auth.origin
				? pipelineWebhookUrl(config.auth.origin, repo.id)
				: null,
		};
	}

	/**
	 * Checks one delivery to `/api/v1/webhooks/pipelines/<repositoryId>`:
	 * the repository exists and has syncing on, the signature matches its
	 * secret, and it's a CI event. A `sync` answer carries the repository
	 * whose runs should be read again.
	 */
	check(
		repo: RepositoryDTO | null,
		headers: Headers,
		rawBody: string,
	): PipelineDeliveryResult {
		if (!repo) {
			return {
				code: 404,
				reason: "No watched repository here.",
				status: "rejected",
			};
		}
		if (
			!verifyGitWebhook(repo.providerKind, headers, rawBody, this.secret(repo))
		) {
			logger.warn(
				`Rejected a CI webhook delivery with a bad signature: repository=${repo.id}`,
			);
			return { code: 401, reason: "Bad signature.", status: "rejected" };
		}
		if (!repo.toJSON().pipelinesEnabled) {
			return { reason: "Syncing CI runs is off.", status: "ignored" };
		}
		if (!isPipelineEvent(headers)) {
			return { reason: "Not a CI event.", status: "ignored" };
		}
		return { repo, status: "sync" };
	}
}

export const PipelineWebhookService = new PipelineWebhookServiceClass();
