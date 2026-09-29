import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { isCommitSha } from "$lib/git-ref";
import { type PullRequestEvent, previewSlug } from "$lib/git-webhooks";
import { Logger } from "$lib/logger";
import { previewBranchAllowed } from "$lib/preview-branches";
import { invalidateGatedService } from "$lib/server/gated-service-cache";
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

/** What a preview's env overrides can refer to: `{pr}`, `{branch}` and `{slug}`. */
interface PreviewValues {
	branch: string | null;
	pr: number;
	slug: string;
}

/** An override's value with `{pr}`, `{branch}` and `{slug}` filled in. */
export function renderEnvOverride(
	value: string,
	values: PreviewValues,
): string {
	return value
		.replaceAll("{pr}", String(values.pr))
		.replaceAll("{branch}", values.branch ?? "")
		.replaceAll("{slug}", values.slug);
}

/**
 * A preview's env: the parent's (unless its previews start empty), where any
 * of the parent's own hostnames in a value (an `ORIGIN`, a public URL) point
 * at the preview instead so it doesn't claim to be the parent, then the
 * parent's preview overrides on top.
 */
async function previewEnv(
	parent: ServiceDTO,
	previewHost: string | null,
	values: PreviewValues,
): Promise<Record<string, string>> {
	const row = parent.toJSON();
	const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
	const inherited = row.previewInheritEnv
		? rewriteHostnames(
				parent.envVars ?? {},
				serviceHostnames(row, stack?.slug, config.baseDomain),
				previewHost,
			)
		: {};
	const overrides = Object.fromEntries(
		Object.entries(row.previewEnvOverrides).map(([key, value]) => [
			key,
			renderEnvOverride(value, values),
		]),
	);
	return { ...inherited, ...overrides };
}

/** A Docker volume name for a preview's copy of `volumeName`. */
export function previewVolumeSource(
	previewSlug: string,
	volumeName: string,
): string {
	const safe = volumeName.toLowerCase().replaceAll(/[^a-z0-9_.-]+/g, "-");
	return `homerun-${previewSlug}-${safe}`.slice(0, 200);
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
 * request's head and torn down when it closes or merges. The parent's
 * branch filter (include and exclude glob patterns) decides which pull
 * requests get one.
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
		if (!this.#branchAllowed(parent, event.branch)) {
			const removed = await this.#remove(parent, event.number);
			return removed.status === "removed"
				? removed
				: {
						reason: `${event.branch ?? "A pull request with no branch"} doesn't pass this service's preview branch filter.`,
						status: "ignored",
					};
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

	/**
	 * Deletes the open previews whose branch the service's branch filter no
	 * longer lets through, after the filter changed. Best effort, like
	 * `removeAll`.
	 *
	 * @returns How many previews were removed.
	 */
	async applyBranchFilter(parent: ServiceDTO): Promise<number> {
		const excluded = (await ServiceGitDTO.listPreviews(parent.id)).filter(
			(preview) => !this.#branchAllowed(parent, preview.toJSON().previewBranch),
		);
		await Promise.all(
			excluded.map((preview) =>
				ServiceLifecycleService.deleteService(preview).catch((err) => {
					logger.warn(
						`Couldn't remove filtered-out preview: service=${preview.id} parent=${parent.id}`,
						err,
					);
				}),
			),
		);
		return excluded.length;
	}

	/** Whether the parent's include and exclude patterns let a pull request from `branch` have a preview. */
	#branchAllowed(parent: ServiceDTO, branch: string | null): boolean {
		const row = parent.toJSON();
		return previewBranchAllowed(
			branch,
			row.previewBranchInclude,
			row.previewBranchExclude,
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
	 * Re-applies the parent's preview access policy to every open preview:
	 * updates each one's login wall and allow-lists, drops the cached gate
	 * decision, and redeploys the ones whose wall was switched on or off, since
	 * the forwardAuth middleware is part of their routing labels. A policy
	 * change with the wall already on applies without a redeploy.
	 */
	async applyAccessPolicy(parent: ServiceDTO): Promise<void> {
		const policy = parent.previewAccessPolicy;
		const previews = await ServiceGitDTO.listPreviews(parent.id);
		await Promise.all(
			previews.map(async (preview) => {
				const wasRequired = preview.authRequired;
				await preview.update(policy);
				invalidateGatedService(preview.id);
				await DeploymentService.redeployIfLoginWallChanged(
					preview,
					wasRequired,
					parent.userId,
				);
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
		const policy = parent.previewAccessPolicy;
		const preview = await ServiceDTO.create({
			...settings,
			authRequired: policy.authRequired,
			envVars: await previewEnv(
				parent,
				domains.primaryDomain ??
					defaultHostname(slug, stack?.slug, config.baseDomain),
				{ branch: event.branch, pr: event.number, slug },
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
			authAllowedEmails: policy.authAllowedEmails,
			authAllowedGroups: policy.authAllowedGroups,
			authAllowedUserIds: policy.authAllowedUserIds,
			authProviders: policy.authProviders,
		});
		if (parent.toJSON().previewCopyVolumes) {
			await this.#copyVolumes(parent, preview);
		}
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
			...parent.previewAccessPolicy,
			envVars: await previewEnv(
				parent,
				primaryHostname(preview.toJSON(), stack?.slug, config.baseDomain),
				{ branch: event.branch, pr: event.number, slug: preview.slug },
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

	/**
	 * Gives a new preview its own copy of each of the parent's volumes,
	 * mounted where the parent mounts them. The copy itself happens in the
	 * preview's first deploy (the volume's `seedFrom`), so a large volume
	 * doesn't hold up the pull request webhook.
	 */
	async #copyVolumes(parent: ServiceDTO, preview: ServiceDTO): Promise<void> {
		for (const mount of await ServiceVolumeDTO.listForService(parent.id)) {
			// oxlint-disable-next-line no-await-in-loop -- one volume row then its mount, in order
			const copy = await StorageVolumeDTO.create({
				kind: "volume",
				name: `${mount.volumeName} (PR #${preview.toJSON().previewPrNumber})`,
				previewServiceId: preview.id,
				seedFrom: mount.volumeSource,
				source: previewVolumeSource(preview.slug, mount.volumeName),
				userId: parent.userId,
			});
			// oxlint-disable-next-line no-await-in-loop -- see above
			await ServiceVolumeDTO.attach({
				containerPath: mount.mount.toJSON().containerPath,
				readOnly: mount.mount.toJSON().readOnly,
				serviceId: preview.id,
				volumeId: copy.id,
			});
		}
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
