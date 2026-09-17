import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { isCommitSha } from "$lib/git-ref";
import { type PullRequestEvent, previewSlug } from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import type { ContainerStatus } from "$lib/types";
import { DeploymentService } from "./deploy.service.ts";
import { serviceHostname } from "./dns.service.ts";
import { ServiceLifecycleService } from "./service-lifecycle.service.ts";

const logger = new Logger("Previews");

export interface PreviewSummary {
	branch: string | null;
	gitRef: string | null;
	hostname: string | null;
	id: string;
	name: string;
	prNumber: number;
	slug: string;
	status: ContainerStatus;
	title: string | null;
}

export type PreviewResult =
	| { deploymentId: string; jobId: string; status: "deployed" }
	| { status: "removed"; serviceId: string }
	| { status: "ignored"; reason: string };

/** The ref a preview builds: the pull request's head commit when the provider sent a full SHA, else its branch. */
function previewRef(event: PullRequestEvent): string | null {
	return isCommitSha(event.commit) ? event.commit : event.branch;
}

/** The parent's build and runtime settings a preview mirrors, refreshed on every pull request update. */
function mirroredSettings(parent: ServiceDTO) {
	return {
		authAllowedEmails: parent.authAllowedEmails,
		authAllowedGroups: parent.authAllowedGroups,
		authAllowedUserIds: parent.authAllowedUserIds,
		authProviders: parent.authProviders,
		authRequired: parent.authRequired,
		buildCacheRegistryId: parent.buildCacheRegistryId,
		buildServerRemoteHostId: parent.buildServerRemoteHostId,
		containerPort: parent.containerPort,
		cpuLimit: parent.cpuLimit,
		dnsResolvable: parent.dnsResolvable,
		envVars: parent.envVars,
		gitBakeFile: parent.gitBakeFile,
		gitBakeTarget: parent.gitBakeTarget,
		gitBuildContext: parent.gitBuildContext,
		gitBuildMethod: parent.gitBuildMethod,
		gitDockerfilePath: parent.gitDockerfilePath,
		gitProviderId: parent.gitProviderId,
		gitRepo: parent.gitRepo,
		gitUrl: parent.gitUrl,
		healthcheckCommand: parent.healthcheckCommand,
		memoryLimitMb: parent.memoryLimitMb,
		registryPasswordEnc: parent.registryPasswordEnc,
		registryUrl: parent.registryUrl,
		registryUsername: parent.registryUsername,
	};
}

/**
 * Pull request preview deployments: a git service with previews on gets one
 * extra service per open pull request, `<slug>-pr-<n>`, built from the pull
 * request's head and torn down when it closes or merges.
 */
class PreviewServiceClass {
	/**
	 * Applies one verified pull request event to a service with previews on:
	 * an opened or updated pull request creates or refreshes its preview and
	 * enqueues a deploy as the parent's owner, a closed or merged one deletes
	 * the preview. A pull request from a fork, or one whose head repo is
	 * unknown, is ignored outright: its code would otherwise be built and run
	 * with the parent's env vars. Never throws for an event it can't act on,
	 * it reports why.
	 */
	async handle(
		parent: ServiceDTO,
		event: PullRequestEvent,
	): Promise<PreviewResult> {
		if (event.fromFork) {
			logger.warn(
				`Ignored a pull request from a fork: parent=${parent.id} pr=${event.number}`,
			);
			return {
				reason: `#${event.number} comes from a fork, and fork pull requests are never previewed.`,
				status: "ignored",
			};
		}
		if (event.action === "close") {
			return await this.#remove(parent, event.number);
		}
		const ref = previewRef(event);
		if (!ref) {
			return {
				reason: "The pull request event carried no head branch or commit.",
				status: "ignored",
			};
		}
		const existing = await ServiceGitDTO.getPreview(parent.id, event.number);
		if (existing) {
			return await this.#refresh(parent, existing, event, ref);
		}
		return await this.#create(parent, event, ref);
	}

	/**
	 * Deletes every preview of a service: its containers, DNS records and rows.
	 * Used when previews are turned off and before the service itself is
	 * deleted. Best effort, a preview whose workload can't be removed is logged
	 * and left in place.
	 */
	async removeAll(parent: ServiceDTO): Promise<void> {
		const previews = await ServiceGitDTO.listPreviews(parent.id);
		await Promise.all(
			previews.map((preview) =>
				ServiceLifecycleService.deleteService(preview).catch((err) => {
					logger.warn(
						`Couldn't remove preview: service=${preview.id} parent=${parent.id}`,
						err,
					);
				}),
			),
		);
	}

	/** The previews of a service for the Source tab, newest pull request first. */
	async list(parent: ServiceDTO): Promise<PreviewSummary[]> {
		const previews = await ServiceGitDTO.listPreviews(parent.id);
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		return previews.map((preview) => {
			const row = preview.toJSON();
			return {
				branch: row.previewBranch,
				gitRef: preview.gitRef,
				hostname: preview.dnsResolvable
					? serviceHostname(preview.slug, stack?.slug)
					: null,
				id: preview.id,
				name: preview.name,
				prNumber: preview.toJSON().previewPrNumber ?? 0,
				slug: preview.slug,
				status: preview.currentStatus,
				title: row.previewPrTitle,
			};
		});
	}

	/** Creates the preview service for a newly opened pull request and deploys it. */
	async #create(
		parent: ServiceDTO,
		event: PullRequestEvent,
		ref: string,
	): Promise<PreviewResult> {
		const slug = previewSlug(parent.slug, event.number);
		if (await ServiceDTO.slugTaken(slug)) {
			return {
				reason: `The slug ${slug} is already taken by another service.`,
				status: "ignored",
			};
		}
		const settings = mirroredSettings(parent);
		const preview = await ServiceDTO.create({
			...settings,
			buildSource: "git",
			gitRef: ref,
			image: parent.image,
			name: `${parent.name} PR #${event.number}`,
			networkMode: "bridge",
			portProtocol: parent.portProtocol,
			previewBranch: event.branch,
			previewParentId: parent.id,
			previewPrNumber: event.number,
			previewPrTitle: event.title,
			pullPolicy: parent.pullPolicy,
			restartPolicy: parent.restartPolicy,
			slug,
			stackId: parent.stackId,
			tag: parent.tag,
			userId: parent.userId,
		});
		await preview.update({
			authAllowedEmails: settings.authAllowedEmails,
			authAllowedGroups: settings.authAllowedGroups,
			authAllowedUserIds: settings.authAllowedUserIds,
			authProviders: settings.authProviders,
		});
		logger.info(
			`Preview created: parent=${parent.id} pr=${event.number} service=${preview.id} ref=${ref}`,
		);
		return await this.#deploy(parent, preview);
	}

	/** Points an existing preview at the pull request's new head and redeploys it, unless an update left the head where it was. A reopened pull request always redeploys. */
	async #refresh(
		parent: ServiceDTO,
		preview: ServiceDTO,
		event: PullRequestEvent,
		ref: string,
	): Promise<PreviewResult> {
		const unchanged = preview.gitRef === ref && event.action === "update";
		await preview.update({
			...mirroredSettings(parent),
			gitRef: ref,
			previewBranch: event.branch,
			previewPrTitle: event.title,
		});
		if (unchanged) {
			return {
				reason: `Preview of #${event.number} already builds ${ref}.`,
				status: "ignored",
			};
		}
		return await this.#deploy(parent, preview);
	}

	/** Enqueues a deploy of a preview as the parent service's owner. */
	async #deploy(
		parent: ServiceDTO,
		preview: ServiceDTO,
	): Promise<PreviewResult> {
		const { deploymentId, jobId } = await DeploymentService.enqueueDeploy({
			svc: preview,
			trigger: "push",
			userId: parent.userId,
		});
		return { deploymentId, jobId, status: "deployed" };
	}

	/** Deletes the preview of a closed or merged pull request. */
	async #remove(parent: ServiceDTO, prNumber: number): Promise<PreviewResult> {
		const preview = await ServiceGitDTO.getPreview(parent.id, prNumber);
		if (!preview) {
			return {
				reason: `No preview for #${prNumber}.`,
				status: "ignored",
			};
		}
		try {
			await ServiceLifecycleService.deleteService(preview);
		} catch (err) {
			logger.warn(
				`Couldn't remove preview: service=${preview.id} parent=${parent.id}`,
				err,
			);
			return {
				reason: err instanceof Error ? err.message : String(err),
				status: "ignored",
			};
		}
		logger.info(
			`Preview removed: parent=${parent.id} pr=${prNumber} service=${preview.id}`,
		);
		return { serviceId: preview.id, status: "removed" };
	}
}

export const PreviewService = new PreviewServiceClass();
