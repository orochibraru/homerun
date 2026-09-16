import { randomBytes } from "node:crypto";
import { config } from "$lib/config";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import {
	gitWebhookUrl,
	parsePushEvent,
	verifyGitWebhook,
} from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import type { GitProviderConfig, GitProviderKind } from "$lib/server/db/schema";
import { inferProviderKind } from "$lib/status-checks";
import { DeploymentService } from "./deploy.service.ts";
import { GitProviderService } from "./git-provider.service.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";

const logger = new Logger("GitWebhook");

export interface WebhookSnapshot {
	gitProviderId: string | null;
	gitRepo: string | null;
	gitWebhookId: string | null;
}

export interface PushWebhookDetails {
	error: string | null;
	providerName: string | null;
	registered: boolean;
	secret: string;
	url: string | null;
}

export type WebhookDeliveryResult =
	| { deploymentId: string; jobId: string; status: "deployed" }
	| { status: "ignored"; reason: string }
	| { status: "rejected"; code: 400 | 401 | 404; reason: string };

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
		const wanted = svc.buildSource === "git" && svc.autoDeployOnPush;
		const moved =
			previous.gitProviderId !== svc.gitProviderId ||
			previous.gitRepo !== svc.gitRepo;

		if (previous.gitWebhookId && (!wanted || moved)) {
			await this.#deleteHook(svc.userId, previous);
			await svc.update({ gitWebhookId: null });
		}

		if (!wanted) {
			await svc.update({ gitWebhookError: null, gitWebhookSecretEnc: null });
			return;
		}

		const secret =
			(svc.gitWebhookSecretEnc && decryptSecret(svc.gitWebhookSecretEnc)) ||
			randomBytes(24).toString("hex");
		await svc.update({ gitWebhookSecretEnc: encryptSecret(secret) });

		if (svc.gitWebhookId && !moved) {
			return;
		}
		await svc.update({ gitWebhookError: await this.#register(svc, secret) });
	}

	/**
	 * What the Source tab and the API show about a service's push webhook: the
	 * URL and secret to add it by hand, whether Homerun registered it, and why
	 * not. Null when deploy-on-push is off.
	 */
	async describe(svc: ServiceDTO): Promise<PushWebhookDetails | null> {
		const secret = svc.gitWebhookSecretEnc
			? decryptSecret(svc.gitWebhookSecretEnc)
			: null;
		if (!(svc.autoDeployOnPush && secret)) {
			return null;
		}
		const provider = await enabledProvider(svc.gitProviderId);
		return {
			error: svc.gitWebhookError,
			providerName: provider?.name ?? null,
			registered: !!svc.gitWebhookId,
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
	 * signature against the service's secret, and enqueues a deploy as the
	 * service's owner when the push was to the branch it builds.
	 */
	async handleDelivery(
		svc: ServiceDTO | null,
		headers: Headers,
		rawBody: string,
	): Promise<WebhookDeliveryResult> {
		const secret = svc?.gitWebhookSecretEnc
			? decryptSecret(svc.gitWebhookSecretEnc)
			: null;
		if (!(svc && svc.buildSource === "git" && svc.autoDeployOnPush && secret)) {
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

		const branch = svc.gitRef ?? "main";
		const push = parsePushEvent(headers, payload).find(
			(entry) => entry.branch === branch,
		);
		if (!push) {
			return { reason: `Not a push to ${branch}.`, status: "ignored" };
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
	 * @returns Why it couldn't be registered, or null on success.
	 */
	async #register(svc: ServiceDTO, secret: string): Promise<string | null> {
		if (!config.auth.origin) {
			return "Set the Dashboard URL under Settings → General: it's the address the provider sends pushes to.";
		}
		const provider = await enabledProvider(svc.gitProviderId);
		if (!(provider && svc.gitRepo)) {
			return "This repo wasn't picked from a connected git provider, so add the webhook by hand.";
		}
		const connection = await GitConnectionDTO.getForUserAndProvider(
			svc.userId,
			provider.id,
		);
		if (!connection) {
			return `The service's owner isn't connected to ${provider.name} any more. Reconnect it on the Git Providers page.`;
		}
		try {
			const hookId = await GitProviderService.createPushWebhook(
				provider,
				connection,
				{
					repo: svc.gitRepo,
					secret,
					url: gitWebhookUrl(config.auth.origin, svc.id),
				},
			);
			await svc.update({ gitWebhookId: hookId });
			logger.info(
				`Registered push webhook: service=${svc.id} provider=${provider.id} repo=${svc.gitRepo} hook=${hookId}`,
			);
			return null;
		} catch (err) {
			logger.warn(
				`Couldn't register push webhook: service=${svc.id} provider=${provider.id} repo=${svc.gitRepo}`,
				err,
			);
			return err instanceof Error
				? err.message
				: "Couldn't register the webhook.";
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
