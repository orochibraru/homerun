import { and, count, desc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import type { RevisionConfig } from "$lib/revision-config";
import { type RevisionLike, retainedRevisions } from "$lib/revisions";
import { db } from "$lib/server/db/lib";
import { type Deployment, deployment, service } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";
import { InstanceSettingsDTO } from "./instance-settings-dto";

export interface NewDeploymentInput {
	// Lets a caller pre-generate the id (e.g. the client, so it can start
	// polling the progress endpoint before the create-deployment request
	// even resolves) : falls back to a fresh one when omitted.
	id?: string;
	restoreConfig?: boolean;
	rollbackOfDeploymentId?: string | null;
	serviceId: string;
	status: Deployment["status"];
	userId: string;
}

export type DeploymentUpdateInput = Partial<
	Pick<
		Deployment,
		| "buildSource"
		| "configSnapshot"
		| "containerId"
		| "errorMessage"
		| "finishedAt"
		| "gitCommit"
		| "gitRef"
		| "health"
		| "imageDigest"
		| "imageId"
		| "imageRef"
		| "log"
		| "startedAt"
		| "status"
	>
>;

/** Wraps the `deployment` table : see ServiceDTO for the pattern this follows. */
export class DeploymentDTO extends BaseDTO<Deployment> {
	/**
	 * Loads one deployment by id, unscoped : callers must check ownership
	 * themselves.
	 */
	static async get(id: string): Promise<DeploymentDTO | null> {
		const [row] = await db
			.select()
			.from(deployment)
			.where(eq(deployment.id, id))
			.limit(1);
		return row ? new DeploymentDTO(row) : null;
	}

	/** Most recent deployments of one service, newest first. */
	static async listForService(
		serviceId: string,
		limit = 10,
	): Promise<DeploymentDTO[]> {
		const rows = await db
			.select()
			.from(deployment)
			.where(eq(deployment.serviceId, serviceId))
			.orderBy(desc(deployment.createdAt))
			.limit(limit);
		return rows.map((row) => new DeploymentDTO(row));
	}

	/**
	 * A service's rollback candidates : deployments that produced an image and
	 * reached running or stopped, newest first.
	 */
	static async listRevisions(
		serviceId: string,
		limit = 50,
	): Promise<DeploymentDTO[]> {
		const rows = await db
			.select()
			.from(deployment)
			.where(
				and(
					eq(deployment.serviceId, serviceId),
					isNotNull(deployment.imageRef),
					inArray(deployment.status, ["running", "stopped"]),
				),
			)
			.orderBy(desc(deployment.createdAt))
			.limit(limit);
		return rows.map((row) => new DeploymentDTO(row));
	}

	/**
	 * Every deployment whose health is still being watched after rollout, for the
	 * auto-rollback checker.
	 */
	static async listWatching(): Promise<DeploymentDTO[]> {
		const rows = await db
			.select()
			.from(deployment)
			.where(eq(deployment.health, "watching"));
		return rows.map((row) => new DeploymentDTO(row));
	}

	/** Loads one deployment by id only if it belongs to the given service. */
	static async getForService(
		serviceId: string,
		id: string,
	): Promise<DeploymentDTO | null> {
		const [row] = await db
			.select()
			.from(deployment)
			.where(and(eq(deployment.id, id), eq(deployment.serviceId, serviceId)))
			.limit(1);
		return row ? new DeploymentDTO(row) : null;
	}

	/**
	 * The revisions kept across every service (the newest distinct images per
	 * service, as many as the instance's retained images setting allows), whose
	 * images must survive cleanup and mirror garbage collection.
	 */
	static async listRetainedRevisions(): Promise<RevisionLike[]> {
		const rows = await db
			.select({
				buildSource: deployment.buildSource,
				createdAt: deployment.createdAt,
				health: deployment.health,
				id: deployment.id,
				imageDigest: deployment.imageDigest,
				imageId: deployment.imageId,
				imageRef: deployment.imageRef,
				rollbackOfDeploymentId: deployment.rollbackOfDeploymentId,
				serviceId: deployment.serviceId,
				status: deployment.status,
			})
			.from(deployment)
			.where(
				and(
					isNotNull(deployment.imageRef),
					inArray(deployment.status, ["running", "stopped"]),
				),
			)
			.orderBy(desc(deployment.createdAt));
		const settings = await InstanceSettingsDTO.get();
		return retainedRevisions(rows, settings.retainedImagesPerService);
	}

	/** Every failed deployment attempt for a service, newest first : for the Errors tab. */
	static async listFailedForService(
		serviceId: string,
		limit = 50,
		since: Date | null = null,
	): Promise<DeploymentDTO[]> {
		const conditions = [
			eq(deployment.serviceId, serviceId),
			eq(deployment.status, "failed"),
		];
		if (since) {
			conditions.push(gt(deployment.createdAt, since));
		}
		const rows = await db
			.select()
			.from(deployment)
			.where(and(...conditions))
			.orderBy(desc(deployment.createdAt))
			.limit(limit);
		return rows.map((row) => new DeploymentDTO(row));
	}

	/**
	 * Counts a service's failed deployments created at or before `until`, so the
	 * Errors tab can say how many a dismissal is hiding.
	 */
	static async countFailedForServiceUpTo(
		serviceId: string,
		until: Date,
	): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(deployment)
			.where(
				and(
					eq(deployment.serviceId, serviceId),
					eq(deployment.status, "failed"),
					lte(deployment.createdAt, until),
				),
			);
		return row?.total ?? 0;
	}

	/** Recent deployments across a set of services, for a stack's own summary. */
	static async listRecentForServices(
		serviceIds: string[],
		limit = 5,
	): Promise<
		Array<{
			deployment: DeploymentDTO;
			serviceName: string | null;
			serviceSlug: string | null;
		}>
	> {
		if (serviceIds.length === 0) {
			return [];
		}
		const rows = await db
			.select({
				row: deployment,
				serviceName: service.name,
				serviceSlug: service.slug,
			})
			.from(deployment)
			.leftJoin(service, eq(deployment.serviceId, service.id))
			.where(inArray(deployment.serviceId, serviceIds))
			.orderBy(desc(deployment.createdAt))
			.limit(limit);
		return rows.map((r) => ({
			deployment: new DeploymentDTO(r.row),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		}));
	}

	/** The newest deployments across every service, plus each row's service name/slug, for the dashboard. */
	static async listRecent(limit = 5): Promise<
		Array<{
			deployment: DeploymentDTO;
			serviceName: string | null;
			serviceSlug: string | null;
		}>
	> {
		const rows = await db
			.select({
				row: deployment,
				serviceName: service.name,
				serviceSlug: service.slug,
			})
			.from(deployment)
			.leftJoin(service, eq(deployment.serviceId, service.id))
			.orderBy(desc(deployment.createdAt))
			.limit(limit);
		return rows.map((r) => ({
			deployment: new DeploymentDTO(r.row),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		}));
	}

	/**
	 * Inserts a new deployment row with an empty log, using the caller's
	 * pre-generated id when one is given.
	 */
	static async create(input: NewDeploymentInput): Promise<DeploymentDTO> {
		const now = new Date();
		const row: Deployment = {
			buildSource: null,
			configSnapshot: null,
			containerId: null,
			createdAt: now,
			errorMessage: null,
			finishedAt: null,
			gitCommit: null,
			gitRef: null,
			health: null,
			id: input.id || crypto.randomUUID(),
			imageDigest: null,
			imageId: null,
			imageRef: null,
			log: "",
			restoreConfig: input.restoreConfig ?? false,
			rollbackOfDeploymentId: input.rollbackOfDeploymentId ?? null,
			serviceId: input.serviceId,
			startedAt: now,
			status: input.status,
			userId: input.userId,
		};
		await db.insert(deployment).values(row);
		return new DeploymentDTO(row);
	}

	/** Writes the given fields to the row and mirrors them onto this instance. */
	async update(input: DeploymentUpdateInput): Promise<void> {
		await db
			.update(deployment)
			.set(input)
			.where(eq(deployment.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Appends one line to the live progress log (see the `deployment.log` column). */
	async appendLog(line: string): Promise<void> {
		const next = `${this.row.log ?? ""}${line}\n`;
		await this.update({ log: next });
	}

	/** The deployment's id. */
	get id(): string {
		return this.row.id;
	}
	/**
	 * The live progress log accumulated so far, empty when nothing was written.
	 */
	get log(): string {
		return this.row.log ?? "";
	}
	/** The deployment this one rolled back to, null when it wasn't a rollback. */
	get rollbackOfDeploymentId(): string | null {
		return this.row.rollbackOfDeploymentId;
	}
	/** Whether this rollback also puts back the target revision's env vars, resources and networking. */
	get restoreConfig(): boolean {
		return this.row.restoreConfig;
	}
	/** The env vars, resources and networking this deploy ran with, null for a deploy recorded before snapshots existed. */
	get configSnapshot(): RevisionConfig | null {
		return this.row.configSnapshot;
	}

	/**
	 * The row for a `load` or API response, with the config snapshot (which
	 * holds the deploy's env vars) swapped for a flag saying whether one exists,
	 * so secrets never reach the browser or an API client.
	 */
	override toJSON(): Deployment & { hasConfigSnapshot: boolean } {
		return {
			...this.row,
			configSnapshot: null,
			hasConfigSnapshot: this.row.configSnapshot !== null,
		};
	}
}
