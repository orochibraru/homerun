import { randomBytes } from "node:crypto";
import { config } from "$lib/config";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { isCommitSha } from "$lib/git-ref";
import {
	gitWebhookUrl,
	parsePullRequestEvent,
	parsePushEvent,
	verifyGitWebhook,
} from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import type { GitProviderConfig, GitProviderKind } from "$lib/server/db/schema";
import { inferProviderKind } from "$lib/status-checks";
import { DeploymentService } from "./deploy.service.ts";
import {
	GitProviderRefusedError,
	GitProviderService,
} from "./git-provider.service.ts";
import { PreviewService } from "./preview.service.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";

const logger = new Logger("GitWebhook");

export interface WebhookSnapshot {
	gitProviderId: string | null;
	gitRepo: string | null;
	gitWebhookId: string | null;
	previewsEnabled?: boolean;
}

export interface PushWebhookDetails {
	error: string | null;
	polling: boolean;
	providerName: string | null;
	reconnect: { providerId: string; providerName: string } | null;
	registered: boolean;
	secret: string;
	url: string | null;
}

export type WebhookDeliveryResult =
	| { deploymentId: string; jobId: string; status: "deployed" }
	| { status: "removed"; serviceId: string }
	| { status: "ignored"; reason: string }
	| { status: "rejected"; code: 400 | 401 | 404; reason: string };

interface RegistrationOutcome {
	error: string | null;
	reconnect: boolean;
}

/** Whether a service wants a webhook on its repo at all: pushes to deploy, or pull requests to preview. */
function wantsWebhook(svc: ServiceDTO): boolean {
	return (
		svc.buildSource === "git" &&
		!svc.toJSON().previewParentId &&
		(svc.autoDeployOnPush || svc.toJSON().previewsEnabled)
	);
}

/** The configured, enabled provider with this id, null otherwise. */
async function enabledProvider(
	providerId: string | null,
): Promise<GitProviderConfig | null> {
	if (!providerId) {
		return null;
	}
	const settings = await InstanceSettingsDTO.get();
	return (
		settings.gitProviders.find((p) => p.id === providerId && p.enabled) ?? null
	);
}

/**
 * Push-to-deploy: keeps each git-built service's webhook on its provider in
 * step with its settings, and turns verified push deliveries into deploys.
 */
class GitWebhookServiceClass {
	/**
	 * Makes the provider side match the service after its source settings
	 * changed. `previous` is what the service looked like before the change,
	 * so a hook on a repo it no longer builds from gets removed. Whenever
	 * deploy-on-push is on the service gets a webhook secret, so the hook can
	 * also be added by hand when Homerun can't register it (a pasted URL, a
	 * connection without webhook access, an unreachable provider); the reason
	 * is kept in `gitWebhookError` for the Source tab. Never throws.
	 */
	async sync(svc: ServiceDTO, previous: WebhookSnapshot): Promise<void> {
		const wanted = wantsWebhook(svc);
		const moved =
			previous.gitProviderId !== svc.gitProviderId ||
			previous.gitRepo !== svc.gitRepo ||
			(previous.previewsEnabled !== undefined &&
				previous.previewsEnabled !== svc.toJSON().previewsEnabled);

		if (previous.gitWebhookId && (!wanted || moved)) {
			await this.#deleteHook(svc.userId, previous);
			await svc.update({ gitWebhookId: null });
		}

		if (!wanted) {
			await svc.update({
				gitWebhookError: null,
				gitWebhookReconnect: false,
				gitWebhookSecretEnc: null,
			});
			return;
		}

		const secret =
			(svc.gitWebhookSecretEnc && decryptSecret(svc.gitWebhookSecretEnc)) ||
			randomBytes(24).toString("hex");
		await svc.update({ gitWebhookSecretEnc: encryptSecret(secret) });

		if (svc.gitWebhookId && !moved) {
			return;
		}
		const outcome = await this.#register(svc, secret);
		await svc.update({
			gitWebhookError: outcome.error,
			gitWebhookReconnect: outcome.reconnect,
		});
	}

	/**
	 * Retries the webhook of every service a user owns on a provider whose
	 * registration didn't go through, right after that user reconnected the
	 * provider (usually to grant the webhook scope). Never throws.
	 */
	async retryAfterReconnect(userId: string, providerId: string): Promise<void> {
		const services = await ServiceGitDTO.listAwaitingWebhook(
			userId,
			providerId,
		);
		for (const svc of services) {
			// oxlint-disable-next-line no-await-in-loop -- one provider API call at a time is plenty for a reconnect
			await this.sync(svc, {
				gitProviderId: svc.gitProviderId,
				gitRepo: svc.gitRepo,
				gitWebhookId: null,
			}).catch((err) => {
				logger.warn(`Webhook retry failed: service=${svc.id}`, err);
			});
		}
	}

	/**
	 * What the Source tab and the API show about a service's push webhook: the
	 * URL and secret to add it by hand, whether Homerun registered it, and why
	 * not, whether reconnecting the provider would fix it, and whether the
	 * branch is polled instead. Null when neither deploy-on-push nor previews
	 * are on.
	 */
	async describe(svc: ServiceDTO): Promise<PushWebhookDetails | null> {
		const secret = svc.gitWebhookSecretEnc
			? decryptSecret(svc.gitWebhookSecretEnc)
			: null;
		if (!(wantsWebhook(svc) && secret)) {
			return null;
		}
		const provider = await enabledProvider(svc.gitProviderId);
		const registered = !!svc.gitWebhookId;
		return {
			error: svc.gitWebhookError,
			polling:
				svc.autoDeployOnPush &&
				!isCommitSha(svc.gitRef) &&
				(svc.toJSON().gitPollEnabled || !registered),
			providerName: provider?.name ?? null,
			reconnect:
				provider && !registered && svc.toJSON().gitWebhookReconnect
					? { providerId: provider.id, providerName: provider.name }
					: null,
			registered,
			secret,
			url: config.auth.origin
				? gitWebhookUrl(config.auth.origin, svc.id)
				: null,
		};
	}

	/** Removes the service's webhook from its provider, for a service being deleted. Never throws. */
	async remove(svc: ServiceDTO): Promise<void> {
		if (svc.gitWebhookId) {
			await this.#deleteHook(svc.userId, svc);
		}
	}

	/**
	 * Handles one delivery to `/api/v1/webhooks/git/<serviceId>`: checks the
	 * signature against the service's secret, then either hands a pull request
	 * event to `PreviewService` when previews are on, or enqueues a deploy as
	 * the service's owner when a push was to the branch it builds.
	 */
	async handleDelivery(
		svc: ServiceDTO | null,
		headers: Headers,
		rawBody: string,
	): Promise<WebhookDeliveryResult> {
		const secret = svc?.gitWebhookSecretEnc
			? decryptSecret(svc.gitWebhookSecretEnc)
			: null;
		if (!(svc && wantsWebhook(svc) && secret)) {
			return {
				code: 404,
				reason: "No service with deploy-on-push here.",
				status: "rejected",
			};
		}

		const kind = await this.#kindFor(svc);
		if (!verifyGitWebhook(kind, headers, rawBody, secret)) {
			logger.warn(
				`Rejected a webhook delivery with a bad signature: service=${svc.id}`,
			);
			return { code: 401, reason: "Bad signature.", status: "rejected" };
		}

		let payload: unknown;
		try {
			payload = JSON.parse(rawBody);
		} catch {
			return {
				code: 400,
				reason: "Expected a JSON payload.",
				status: "rejected",
			};
		}

		const pullRequest = parsePullRequestEvent(headers, payload);
		if (pullRequest) {
			return svc.toJSON().previewsEnabled
				? await PreviewService.handle(svc, pullRequest)
				: { reason: "Pull request previews are off.", status: "ignored" };
		}

		const branch = svc.gitRef ?? "main";
		const push = parsePushEvent(headers, payload).find(
			(entry) => entry.branch === branch,
		);
		if (!(svc.autoDeployOnPush && push)) {
			return { reason: `Not a push to ${branch}.`, status: "ignored" };
		}
		if (push.commit) {
			await svc.update({ gitLastSeenCommit: push.commit });
		}

		const { deploymentId, jobId } = await DeploymentService.enqueueDeploy({
			svc,
			trigger: "push",
			userId: svc.userId,
		});
		logger.info(
			`Push to ${branch} (${push.commit ?? "unknown commit"}) deploys service=${svc.id} deployment=${deploymentId}`,
		);
		return { deploymentId, jobId, status: "deployed" };
	}

	/** The provider kind whose signature scheme a delivery uses, null when it can't be told from the service. */
	async #kindFor(svc: ServiceDTO): Promise<GitProviderKind | null> {
		const provider = await enabledProvider(svc.gitProviderId);
		return (
			provider?.kind ?? (svc.gitUrl ? inferProviderKind(svc.gitUrl) : null)
		);
	}

	/**
	 * Registers the service's webhook with its provider and records the hook
	 * id.
	 *
	 * @returns Why it couldn't be registered (null on success), and whether
	 * reconnecting the provider is what fixes it.
	 */
	async #register(
		svc: ServiceDTO,
		secret: string,
	): Promise<RegistrationOutcome> {
		if (!config.auth.origin) {
			return {
				error:
					"Set the Dashboard URL under Settings → General: it's the address the provider sends pushes to.",
				reconnect: false,
			};
		}
		const provider = await enabledProvider(svc.gitProviderId);
		if (!(provider && svc.gitRepo)) {
			return {
				error:
					"This repo wasn't picked from a connected git provider, so add the webhook by hand.",
				reconnect: false,
			};
		}
		const connection = await GitConnectionDTO.getForUserAndProvider(
			svc.userId,
			provider.id,
		);
		if (!connection) {
			return {
				error: `The service's owner isn't connected to ${provider.name} any more.`,
				reconnect: true,
			};
		}
		try {
			const hookId = await GitProviderService.createPushWebhook(
				provider,
				connection,
				{
					pullRequests: svc.toJSON().previewsEnabled,
					repo: svc.gitRepo,
					secret,
					url: gitWebhookUrl(config.auth.origin, svc.id),
				},
			);
			await svc.update({ gitWebhookId: hookId });
			logger.info(
				`Registered push webhook: service=${svc.id} provider=${provider.id} repo=${svc.gitRepo} hook=${hookId}`,
			);
			return { error: null, reconnect: false };
		} catch (err) {
			logger.warn(
				`Couldn't register push webhook: service=${svc.id} provider=${provider.id} repo=${svc.gitRepo}`,
				err,
			);
			return {
				error:
					err instanceof Error ? err.message : "Couldn't register the webhook.",
				reconnect: err instanceof GitProviderRefusedError && err.reconnectHelps,
			};
		}
	}

	/** Deletes a previously registered hook, logging rather than throwing when the provider refuses. */
	async #deleteHook(userId: string, hook: WebhookSnapshot): Promise<void> {
		const provider = await enabledProvider(hook.gitProviderId);
		const connection = provider
			? await GitConnectionDTO.getForUserAndProvider(userId, provider.id)
			: null;
		if (!(provider && connection && hook.gitRepo && hook.gitWebhookId)) {
			return;
		}
		try {
			await GitProviderService.deletePushWebhook(
				provider,
				connection,
				hook.gitRepo,
				hook.gitWebhookId,
			);
		} catch (err) {
			logger.warn(
				`Couldn't remove push webhook: provider=${provider.id} repo=${hook.gitRepo} hook=${hook.gitWebhookId}`,
				err,
			);
		}
	}
}

export const GitWebhookService = new GitWebhookServiceClass();
