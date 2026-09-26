import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { isRevision, revisionEntries, revisionImageRefs } from "$lib/revisions";
import type { Deployment, Service } from "$lib/server/db/schema";
import type { RevisionHealth } from "$lib/types";
import { DeploymentService } from "./deploy.service.ts";
import { DockerService } from "./docker.service.ts";

type DeploymentRow = Deployment & { hasConfigSnapshot: boolean };

type ServiceWorkload = Pick<Service, "containerId" | "id" | "swarmServiceId">;

export interface RevisionView {
	buildSource: Deployment["buildSource"];
	createdAt: Date;
	current: boolean;
	deployable: boolean;
	environment: string;
	errorMessage: string | null;
	finishedAt: Date | null;
	gitCommit: string | null;
	gitRef: string | null;
	hasConfigSnapshot: boolean;
	health: RevisionHealth | null;
	healthReason: string | null;
	id: string;
	imageDigest: string | null;
	imageId: string | null;
	imageRef: string | null;
	lastDeployedAt: Date | null;
	latestDeploymentId: string;
	log: string;
	previous: boolean;
	redeployCount: number;
	retained: boolean;
	startedAt: Date | null;
	status: Deployment["status"];
}

const MAX_ROOT_DEPTH = 10;

export class RevisionError extends Error {
	override name = "RevisionError";
	readonly status: number;

	/** @param status The HTTP status a route should respond with for this error. */
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

class RevisionServiceClass {
	/**
	 * A service's successful revisions, one entry per revision (redeploys
	 * folded in), for the API and CLI.
	 */
	async list(svc: ServiceWorkload): Promise<RevisionView[]> {
		return await this.#view(svc, await DeploymentDTO.listRevisions(svc.id));
	}

	/**
	 * The Revisions tab's list: the service's recent deployments, failed
	 * attempts included, with every rollback folded into the revision it
	 * redeployed.
	 */
	async history(svc: ServiceWorkload, limit = 30): Promise<RevisionView[]> {
		return await this.#view(
			svc,
			await DeploymentDTO.listForService(svc.id, limit),
		);
	}

	/** Loads the revisions the given rows redeployed but that fell outside the loaded window, then builds the view. */
	async #view(
		svc: ServiceWorkload,
		deployments: DeploymentDTO[],
	): Promise<RevisionView[]> {
		const rows = await this.#withRoots(
			svc.id,
			deployments.map((dep) => dep.toJSON()),
		);
		const settings = await InstanceSettingsDTO.get();
		return this.annotate(svc, rows, settings.retainedImagesPerService);
	}

	/**
	 * Adds every row a loaded rollback points at (and what that one points at,
	 * a few levels up) when it isn't loaded already, so a revision redeployed
	 * long after it first ran still shows as one entry.
	 */
	async #withRoots(
		serviceId: string,
		rows: DeploymentRow[],
		depth = 0,
	): Promise<DeploymentRow[]> {
		const known = new Set(rows.map((row) => row.id));
		const missing = new Set(
			rows
				.map((row) => row.rollbackOfDeploymentId)
				.filter((id): id is string => Boolean(id && !known.has(id))),
		);
		if (missing.size === 0 || depth >= MAX_ROOT_DEPTH) {
			return rows;
		}
		const loaded = await DeploymentDTO.listByIdsForService(serviceId, [
			...missing,
		]);
		if (loaded.length === 0) {
			return rows;
		}
		return await this.#withRoots(
			serviceId,
			[...rows, ...loaded.map((dep) => dep.toJSON())],
			depth + 1,
		);
	}

	/**
	 * Builds the Revisions list from deployment rows: one entry per revision,
	 * in the order revisions were first deployed, a rollback folded into the
	 * revision it redeployed (see `revisionEntries`). Marks `current` (the
	 * deployed revision, only when the service actually has a running
	 * workload), `previous` (the rollback target) and `retained` (its image is
	 * among the newest `retainedLimit` distinct ones, kept from pruning).
	 * Status, log, error and timings come from the entry's latest attempt,
	 * `lastDeployedAt` and health from its latest successful run.
	 */
	annotate(
		svc: Pick<Service, "containerId" | "swarmServiceId">,
		rows: DeploymentRow[],
		retainedLimit: number,
	): RevisionView[] {
		const entries = revisionEntries(rows, {
			deployed: Boolean(svc.containerId || svc.swarmServiceId),
			retainedLimit,
		});
		return entries.map((entry) => {
			const { lastDeployed, latest, revision } = entry;
			return {
				buildSource: revision.buildSource,
				createdAt: revision.createdAt,
				current: entry.current,
				deployable: isRevision(revision),
				environment: revision.environment,
				errorMessage: latest.errorMessage,
				finishedAt: latest.finishedAt,
				gitCommit: revision.gitCommit,
				gitRef: revision.gitRef,
				hasConfigSnapshot: revision.hasConfigSnapshot,
				health: entry.health,
				healthReason:
					entry.health === "unhealthy" || entry.health === "rolled_back"
						? (entry.lastDeployed?.healthReason ?? null)
						: null,
				id: revision.id,
				imageDigest: revision.imageDigest,
				imageId: revision.imageId,
				imageRef: revision.imageRef,
				lastDeployedAt: lastDeployed
					? (lastDeployed.finishedAt ?? lastDeployed.createdAt)
					: null,
				latestDeploymentId: latest.id,
				log: latest.log ?? "",
				previous: entry.previous,
				redeployCount: entry.redeployCount,
				retained: entry.retained,
				startedAt: latest.startedAt,
				status: latest.status,
			};
		});
	}

	/** The Docker image ids backing every retained revision across all services, for the pruner to skip. */
	async retainedImageIds(): Promise<string[]> {
		const revisions = await DeploymentDTO.listRetainedRevisions();
		return await DockerService.existingImageIds(
			revisions.flatMap(revisionImageRefs),
		);
	}

	/**
	 * Resolves the deployment to roll back to: an explicit `revisionId` if
	 * given (a redeploy's id resolves to the revision it redeployed, then is
	 * validated as a real successful revision), otherwise the service's
	 * previous revision. Always the revision's original row, so the rollback
	 * folds into that entry on the Revisions list.
	 *
	 * @throws `RevisionError` when the requested revision doesn't exist or
	 *   never ran successfully, or when there's no previous revision to fall
	 *   back to.
	 */
	async resolveTarget(
		svc: ServiceDTO,
		revisionId: string | null,
	): Promise<DeploymentDTO> {
		if (revisionId) {
			const revision = await this.#root(
				svc.id,
				await DeploymentDTO.getForService(svc.id, revisionId),
			);
			if (!(revision && isRevision(revision.toJSON()))) {
				throw new RevisionError(
					"That revision wasn't found, or never ran successfully.",
					404,
				);
			}
			return revision;
		}
		const previous = (await this.list(svc)).find((row) => row.previous);
		if (!previous) {
			throw new RevisionError(
				"There's no previous revision with a different image to roll back to.",
				400,
			);
		}
		const revision = await DeploymentDTO.getForService(svc.id, previous.id);
		if (!revision) {
			throw new RevisionError("That revision wasn't found.", 404);
		}
		return revision;
	}

	/** Follows a deployment's `rollbackOfDeploymentId` chain up to the original deploy it redeployed, stopping at a missing row. */
	async #root(
		serviceId: string,
		deployment: DeploymentDTO | null,
		depth = 0,
	): Promise<DeploymentDTO | null> {
		const parentId = deployment?.rollbackOfDeploymentId;
		if (!parentId || depth >= MAX_ROOT_DEPTH) {
			return deployment;
		}
		const parent = await DeploymentDTO.getForService(serviceId, parentId);
		return parent ? await this.#root(serviceId, parent, depth + 1) : deployment;
	}

	/** Non-throwing wrapper over `resolveTarget`, for a route to turn straight into an error response. */
	async findTarget(
		svc: ServiceDTO,
		revisionId: string | null,
	): Promise<
		| { error: null; revision: DeploymentDTO }
		| { error: string; revision: null; status: number }
	> {
		try {
			return {
				error: null,
				revision: await this.resolveTarget(svc, revisionId),
			};
		} catch (err) {
			if (err instanceof RevisionError) {
				return { error: err.message, revision: null, status: err.status };
			}
			throw err;
		}
	}

	/** Enqueues a redeploy of `input.revision` as a rollback, optionally putting back that revision's env vars, resources and networking too (`restoreConfig`). */
	async enqueueRollback(input: {
		restoreConfig?: boolean;
		revision: DeploymentDTO;
		svc: ServiceDTO;
		userId: string;
	}) {
		return await DeploymentService.enqueueDeploy({
			restoreConfig: input.restoreConfig ?? false,
			rollbackOfDeploymentId: input.revision.id,
			svc: input.svc,
			userId: input.userId,
		});
	}
}

export const RevisionService = new RevisionServiceClass();
