import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import {
	isRevision,
	previousRevision,
	retainedRevisions,
	revisionImageRefs,
} from "$lib/revisions";
import type { Deployment, Service } from "$lib/server/db/schema";
import { DeploymentService } from "./deploy.service.ts";
import { DockerService } from "./docker.service.ts";

export interface RevisionView extends Deployment {
	current: boolean;
	previous: boolean;
	retained: boolean;
}

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
	/** A service's revision history, annotated with which one is current/previous/retained. */
	async list(svc: ServiceDTO): Promise<RevisionView[]> {
		const rows = (await DeploymentDTO.listRevisions(svc.id)).map((dep) =>
			dep.toJSON(),
		);
		const settings = await InstanceSettingsDTO.get();
		return this.annotate(svc.toJSON(), rows, settings.retainedImagesPerService);
	}

	/**
	 * Marks each deployment row as `current` (the deployed revision, only
	 * when the service actually has a running workload), `previous` (the
	 * rollback target), and `retained` (among the newest `retainedLimit`
	 * distinct images, kept from image-pruning).
	 */
	annotate<TRow extends Deployment>(
		svc: Pick<Service, "containerId" | "swarmServiceId">,
		rows: TRow[],
		retainedLimit: number,
	): (TRow & Omit<RevisionView, keyof Deployment>)[] {
		const deployed = Boolean(svc.containerId || svc.swarmServiceId);
		const revisions = rows.filter(isRevision);
		const current = deployed ? (revisions[0] ?? null) : null;
		const previous = previousRevision(revisions, current?.id ?? null);
		const retained = new Set(
			retainedRevisions(revisions, retainedLimit).map((r) => r.id),
		);
		return rows.map((row) => ({
			...row,
			current: row.id === current?.id,
			previous: row.id === previous?.id,
			retained: retained.has(row.id),
		}));
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
	 * given (validated as a real successful revision), otherwise the
	 * service's previous revision.
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
			const revision = await DeploymentDTO.getForService(svc.id, revisionId);
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
