import { config } from "$lib/config";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceGitDTO } from "$lib/dto/service-git-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { primaryHostname, serviceHostnames } from "$lib/service-domains";
import type { ContainerStatus, RevisionHealth } from "$lib/types";
import { DeploymentService } from "./deploy.service.ts";
import { PreviewService } from "./preview.service.ts";
import { RevisionService, type RevisionView } from "./revision.service.ts";

const logger = new Logger("Previews");

export interface PreviewRevision {
	deployedAt: Date | null;
	gitCommit: string | null;
	gitRef: string | null;
	health: RevisionHealth | null;
	healthReason: string | null;
	id: string;
	imageDigest: string | null;
	imageRef: string | null;
}

export interface PreviewDeployment {
	createdAt: Date;
	errorMessage: string | null;
	finishedAt: Date | null;
	gitCommit: string | null;
	gitRef: string | null;
	id: string;
	status: ContainerStatus;
}

export interface PreviewView {
	branch: string | null;
	deployment: PreviewDeployment | null;
	gitRef: string | null;
	hostnames: string[];
	id: string;
	name: string;
	prNumber: number;
	revision: PreviewRevision | null;
	slug: string;
	status: ContainerStatus;
	title: string | null;
	url: string | null;
}

export type PromoteResult =
	| {
			deploymentId: string;
			error: null;
			jobId: string;
			preview: PreviewView;
			revision: PreviewRevision;
	  }
	| { error: string; status: number };

const PROMOTABLE_HEALTH = new Set<RevisionHealth | null>([null, "healthy"]);

/** The part of a revision a preview's API view shows. */
function revisionOf(view: RevisionView): PreviewRevision {
	return {
		deployedAt: view.lastDeployedAt,
		gitCommit: view.gitCommit,
		gitRef: view.gitRef,
		health: view.health,
		healthReason: view.healthReason,
		id: view.id,
		imageDigest: view.imageDigest,
		imageRef: view.imageRef,
	};
}

/** Whether `given`, a full or abbreviated SHA, names `full`. */
function sameCommit(full: string | null, given: string): boolean {
	return Boolean(full?.toLowerCase().startsWith(given.toLowerCase()));
}

/**
 * Pull request previews as the REST API and CLI see them: each one's current
 * revision and latest deploy attempt, for CI to wait on, and promotion of a
 * preview's exact image to the service it previews.
 */
class PreviewApiServiceClass {
	/** The open previews of `parent`, newest pull request first. */
	async list(parent: ServiceDTO): Promise<PreviewView[]> {
		const previews = await ServiceGitDTO.listPreviews(parent.id);
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		return await Promise.all(
			previews.map((preview) => this.#view(preview, stack?.slug)),
		);
	}

	/** The preview of pull request `prNumber` on `parent`, null when there's none. */
	async get(parent: ServiceDTO, prNumber: number): Promise<PreviewView | null> {
		const preview = await ServiceGitDTO.getPreview(parent.id, prNumber);
		if (!preview) {
			return null;
		}
		const stack = parent.stackId ? await StackDTO.get(parent.stackId) : null;
		return await this.#view(preview, stack?.slug);
	}

	/**
	 * Deletes the preview of pull request `prNumber` through
	 * `PreviewService.delete`.
	 *
	 * @returns false when there's no such preview.
	 * @throws When the preview's workload can't be removed.
	 */
	async delete(parent: ServiceDTO, prNumber: number): Promise<boolean> {
		const preview = await ServiceGitDTO.getPreview(parent.id, prNumber);
		if (!preview) {
			return false;
		}
		await PreviewService.delete(parent, preview.id);
		return true;
	}

	/**
	 * Deploys the exact image the preview of pull request `prNumber` runs to
	 * `parent`, through the rollback path: the deploy points at the preview's
	 * revision (`rollbackOfDeploymentId`), so nothing is rebuilt, pulled or
	 * scanned, and its log opens with where the image came from. Refused when
	 * the preview has no running revision, its revision isn't healthy (or
	 * still being watched), or `commit` is given and isn't the commit it runs.
	 */
	async promote(input: {
		commit: string | null;
		parent: ServiceDTO;
		prNumber: number;
		userId: string;
	}): Promise<PromoteResult> {
		const { commit, parent, prNumber, userId } = input;
		if (parent.buildSource !== "git" || parent.toJSON().previewParentId) {
			return {
				error: "Only a service built from git can be promoted to.",
				status: 400,
			};
		}
		const preview = await this.get(parent, prNumber);
		if (!preview) {
			return { error: `There's no preview for #${prNumber}.`, status: 404 };
		}
		const { revision } = preview;
		if (!revision) {
			return {
				error: `The preview of #${prNumber} has no running revision to promote.`,
				status: 409,
			};
		}
		if (commit && !sameCommit(revision.gitCommit, commit)) {
			return {
				error: `The preview of #${prNumber} runs ${revision.gitCommit ?? "an unknown commit"}, not ${commit}.`,
				status: 409,
			};
		}
		if (!PROMOTABLE_HEALTH.has(revision.health)) {
			return {
				error: `The preview of #${prNumber} is ${revision.health === "watching" ? "still being health-checked" : "unhealthy"}, so it isn't promoted.`,
				status: 409,
			};
		}
		const note = `Promoted from the preview of #${prNumber} (${preview.slug}, revision ${revision.id}, commit ${revision.gitCommit ?? "unknown"}): ${revision.imageRef ?? ""}`;
		const { deploymentId, jobId } = await DeploymentService.enqueueDeploy({
			note,
			rollbackOfDeploymentId: revision.id,
			svc: parent,
			userId,
		});
		logger.info(
			`Preview promoted: parent=${parent.id} pr=${prNumber} preview=${preview.id} revision=${revision.id} deployment=${deploymentId} user=${userId}`,
		);
		return { deploymentId, error: null, jobId, preview, revision };
	}

	/** Builds one preview's API view: its hostnames and URL, current revision and latest deploy attempt. */
	async #view(
		preview: ServiceDTO,
		stackSlug: string | undefined,
	): Promise<PreviewView> {
		const row = preview.toJSON();
		const [revisions, [latest]] = await Promise.all([
			RevisionService.list(preview),
			DeploymentDTO.listForService(preview.id, 1),
		]);
		const current = revisions.find((view) => view.current);
		const host = preview.dnsResolvable
			? primaryHostname(row, stackSlug, config.baseDomain)
			: null;
		const scheme = config.traefik.entrypoint === "web" ? "http" : "https";
		const attempt = latest?.toJSON();
		return {
			branch: row.previewBranch,
			deployment: attempt
				? {
						createdAt: attempt.createdAt,
						errorMessage: attempt.errorMessage,
						finishedAt: attempt.finishedAt,
						gitCommit: attempt.gitCommit,
						gitRef: attempt.gitRef,
						id: attempt.id,
						status: attempt.status,
					}
				: null,
			gitRef: preview.gitRef,
			hostnames: preview.dnsResolvable
				? serviceHostnames(row, stackSlug, config.baseDomain)
				: [],
			id: preview.id,
			name: preview.name,
			prNumber: row.previewPrNumber ?? 0,
			revision: current ? revisionOf(current) : null,
			slug: preview.slug,
			status: preview.currentStatus,
			title: row.previewPrTitle,
			url: host ? `${scheme}://${host}` : null,
		};
	}
}

export const PreviewApiService = new PreviewApiServiceClass();
