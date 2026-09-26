import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { isCommitSha } from "$lib/git-ref";
import { type PullRequestEvent, previewSlug } from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import {
	defaultHostname,
	primaryHostname,
	renderPreviewDomain,
	rewriteHostnames,
	serviceHostnames,
} from "$lib/service-domains";
import { isDeployed } from "$lib/service-state";
import type { ContainerStatus } from "$lib/types";
import { CapacityService } from "./capacity.service.ts";
import { DeploymentService } from "./deploy.service.ts";
import { serviceHostname, syncServiceDomainsDns } from "./dns.service.ts";
import { ServiceLifecycleService } from "./service-lifecycle.service.ts";

const logger = new Logger("Previews");

export interface PreviewSummary {
	branch: string | null;
	gitRef: string | null;
	hostname: string | null;
	hostnames: string[];
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

/**
 * The parent's env for a preview whose main hostname is `previewHost`: any
 * of the parent's own hostnames in a value (an `ORIGIN`, a public URL) point
 * at the preview instead, so the preview doesn't claim to be the parent.
 */
async function previewEnv(
	parent: ServiceDTO,
	previewHost: string | null,
): Promise<Record<string, string>> {
	const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
	return rewriteHostnames(
		parent.envVars ?? {},
		serviceHostnames(parent.toJSON(), stack?.slug, config.baseDomain),
		previewHost,
	);
}

/** The parent's build and runtime settings a preview or a release channel canary mirrors, refreshed on every pull request update or canary deploy. */
export function mirroredSettings(parent: ServiceDTO) {
	return {
		authAllowedEmails: parent.authAllowedEmails,
		authAllowedGroups: parent.authAllowedGroups,
		authAllowedUserIds: parent.authAllowedUserIds,
		authProviders: parent.authProviders,
		authRequired: parent.authRequired,
		buildCacheRegistryId: parent.buildCacheRegistryId,
		buildServerRemoteHostId: parent.buildServerRemoteHostId,
		category: parent.category,
		containerPort: parent.containerPort,
		cpuLimit: parent.cpuLimit,
		dnsResolvable: parent.dnsResolvable,
		envVars: parent.envVars,
		gitBakeFile: parent.gitBakeFile,
		gitBuildTarget: parent.gitBuildTarget,
		gitBuildContext: parent.gitBuildContext,
		gitBuildMethod: parent.gitBuildMethod,
		gitDockerfilePath: parent.gitDockerfilePath,
		gitProviderId: parent.gitProviderId,
		gitRepo: parent.gitRepo,
		gitUrl: parent.gitUrl,
		healthcheckCommand: parent.healthcheckCommand,
		healthcheckDisabled: parent.healthcheckDisabled,
		healthcheckIntervalSeconds: parent.healthcheckIntervalSeconds,
		healthcheckRetries: parent.healthcheckRetries,
		healthcheckStartPeriodSeconds: parent.healthcheckStartPeriodSeconds,
		healthcheckTimeoutSeconds: parent.healthcheckTimeoutSeconds,
		icon: parent.icon,
		memoryLimitMb: parent.memoryLimitMb,
		registryPasswordEnc: parent.registryPasswordEnc,
		registryUrl: parent.registryUrl,
		registryUsername: parent.registryUsername,
	};
}

/**
 * The domains a preview gets from its parent's settings: the templated
 * domain when the parent has one and no other service already routes it,
 * and the default `<slug>-pr-<n>` hostname when the parent keeps it or
 * there'd be nothing routed otherwise.
 */
async function previewDomains(
	parent: ServiceDTO,
	values: { branch: string | null; pr: number },
	previewId?: string,
) {
	const row = parent.toJSON();
	const rendered = renderPreviewDomain(row.previewDomainTemplate, {
		...values,
		slug: parent.slug,
	});
	const taken = rendered
		? await ServiceDTO.domainTaken([rendered], previewId)
		: null;
	if (taken) {
		logger.warn(
			`Preview domain already routed to another service, skipped: parent=${parent.id} pr=${values.pr} domain=${taken}`,
		);
	}
	const domains = rendered && !taken ? [rendered] : [];
	return {
		defaultDomainEnabled: row.previewDefaultDomain || domains.length === 0,
		domains,
		primaryDomain: domains[0] ?? null,
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

	/** The previews of a service for its Previews tab, newest pull request first. */
	async list(parent: ServiceDTO): Promise<PreviewSummary[]> {
		const previews = await ServiceGitDTO.listPreviews(parent.id);
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		return previews.map((preview) => {
			const row = preview.toJSON();
			const hostnames = preview.dnsResolvable
				? serviceHostnames(row, stack?.slug, config.baseDomain)
				: [];
			return {
				branch: row.previewBranch,
				gitRef: preview.gitRef,
				hostname: preview.dnsResolvable
					? (row.primaryDomain ?? serviceHostname(preview.slug, stack?.slug))
					: null,
				hostnames,
				id: preview.id,
				name: preview.name,
				prNumber: preview.toJSON().previewPrNumber ?? 0,
				slug: preview.slug,
				status: preview.currentStatus,
				title: row.previewPrTitle,
			};
		});
	}

	/**
	 * Re-applies the parent's preview domain settings to every open preview:
	 * updates each one's domains, brings DNS in line right away and redeploys
	 * the ones already deployed so Traefik picks up the new routes. A preview
	 * the operator gave its own extra domains loses them, the template owns a
	 * preview's domains.
	 */
	async applyDomains(parent: ServiceDTO): Promise<void> {
		const previews = await ServiceGitDTO.listPreviews(parent.id);
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		await Promise.all(
			previews.map(async (preview) => {
				const row = preview.toJSON();
				const previous = serviceHostnames(row, stack?.slug, config.baseDomain);
				await preview.update(
					await previewDomains(
						parent,
						{ branch: row.previewBranch, pr: row.previewPrNumber ?? 0 },
						preview.id,
					),
				);
				if (preview.dnsResolvable) {
					void syncServiceDomainsDns(
						previous,
						serviceHostnames(preview.toJSON(), stack?.slug, config.baseDomain),
					);
				}
				if (isDeployed(preview)) {
					await this.#deploy(parent, preview);
				}
			}),
		);
	}

	/**
	 * Redeploys one preview of `parent` from its pull request's current ref.
	 *
	 * @throws When `previewId` isn't one of `parent`'s previews.
	 */
	async redeploy(
		parent: ServiceDTO,
		previewId: string,
	): Promise<PreviewResult> {
		return await this.#deploy(parent, await this.#own(parent, previewId));
	}

	/**
	 * Deletes one preview of `parent` ahead of its pull request closing; the
	 * next push to that pull request recreates it.
	 *
	 * @throws When `previewId` isn't one of `parent`'s previews, or the
	 * workload can't be removed.
	 */
	async delete(parent: ServiceDTO, previewId: string): Promise<void> {
		const preview = await this.#own(parent, previewId);
		await ServiceLifecycleService.deleteService(preview);
		logger.info(
			`Preview deleted by hand: parent=${parent.id} service=${preview.id}`,
		);
	}

	/** The preview `previewId` when it belongs to `parent`, else throws. */
	async #own(parent: ServiceDTO, previewId: string): Promise<ServiceDTO> {
		const preview = await ServiceDTO.get(previewId);
		if (
			!preview ||
			preview.toJSON().previewParentId !== parent.id ||
			preview.toJSON().channelCanary
		) {
			throw new Error("That preview doesn't belong to this service.");
		}
		return preview;
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
		const full = await CapacityService.refusal();
		if (full) {
			return { reason: full, status: "ignored" };
		}
		const settings = mirroredSettings(parent);
		const domains = await previewDomains(parent, {
			branch: event.branch,
			pr: event.number,
		});
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		const preview = await ServiceDTO.create({
			...settings,
			envVars: await previewEnv(
				parent,
				domains.primaryDomain ??
					defaultHostname(slug, stack?.slug, config.baseDomain),
			),
			domains: domains.domains,
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
			defaultDomainEnabled: domains.defaultDomainEnabled,
			primaryDomain: domains.primaryDomain,
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
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		await preview.update({
			...mirroredSettings(parent),
			envVars: await previewEnv(
				parent,
				primaryHostname(preview.toJSON(), stack?.slug, config.baseDomain),
			),
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
