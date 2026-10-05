import { createHash } from "node:crypto";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { IacStateVersionDTO } from "#lib/dto/iac-state-version-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import {
	diffStates,
	type StateDiff,
	stateObjectKey,
	summarizeState,
	withSerial,
} from "#lib/iac-state.js";
import { bucketNameProblem } from "#lib/object-storage.js";
import type { IacStateLock } from "#lib/server/db/schema.js";
import { slugify, uniqueSlug } from "#lib/slug.js";
import { ObjectStorageService } from "./object-storage.service.ts";
import type { ObjectStoreClient } from "./s3/object-store-client.ts";

export type WriteResult =
	| { ok: true; version: IacStateVersionDTO }
	| { lock: IacStateLock | null; ok: false; reason: "locked" };

export type LockResult =
	| { lock: IacStateLock; ok: true }
	| { lock: IacStateLock; ok: false };

export interface VersionDiff {
	diff: StateDiff;
	previousSerial: number | null;
	serial: number;
}

/**
 * Terraform state kept in a bucket on one of the instance's object stores,
 * served through Terraform's `http` backend: every write is a new version
 * object, so any earlier state can be compared or rolled back to, and the
 * lock lives in Postgres so two applies can't race.
 */
class IacStateServiceClass {
	/**
	 * Creates a project whose state lives in `bucket` on `storeId`, under an
	 * optional folder.
	 *
	 * @throws When the name is empty, the bucket name is invalid or the store
	 *   doesn't exist.
	 */
	async createProject(input: {
		bucket: string;
		name: string;
		prefix: string;
		storeId: string;
		userId: string;
	}): Promise<IacProjectDTO> {
		const name = input.name.trim();
		const base = slugify(name);
		if (!base) {
			throw new Error("Give the project a name.");
		}
		const problem = bucketNameProblem(input.bucket);
		if (problem) {
			throw new Error(problem);
		}
		if (!(await ObjectStoreDTO.get(input.storeId))) {
			throw new Error("That object store doesn't exist.");
		}
		return await IacProjectDTO.create({
			bucket: input.bucket,
			name,
			prefix: input.prefix.trim().replace(/^\/+|\/+$/g, ""),
			slug: await uniqueSlug(base, (slug) => IacProjectDTO.slugTaken(slug)),
			storeId: input.storeId,
			userId: input.userId,
		});
	}

	/**
	 * The S3 client for a project's store.
	 *
	 * @throws When the store is gone or unreachable.
	 */
	async #client(project: IacProjectDTO): Promise<ObjectStoreClient> {
		const store = await ObjectStoreDTO.get(project.storeId);
		if (!store) {
			throw new Error("The project's object store no longer exists.");
		}
		return await ObjectStorageService.client(store);
	}

	/**
	 * The body of one version, read from the bucket.
	 *
	 * @throws When the object is missing from the bucket.
	 */
	async body(
		project: IacProjectDTO,
		version: IacStateVersionDTO,
	): Promise<string> {
		const body = await (await this.#client(project)).getObject(
			project.bucket,
			version.objectKey,
		);
		if (body === null) {
			throw new Error(
				`State version ${version.serial} is missing from ${project.bucket}.`,
			);
		}
		return body;
	}

	/** The latest state's body, or null before Terraform's first write. */
	async read(project: IacProjectDTO): Promise<string | null> {
		const latest = await IacStateVersionDTO.latest(project.id);
		return latest ? await this.body(project, latest) : null;
	}

	/**
	 * Stores a state Terraform sends as a new version, refusing it while the
	 * state is locked under another lock id.
	 *
	 * @throws When the body isn't a Terraform state or the bucket refuses it.
	 */
	async write(
		project: IacProjectDTO,
		body: string,
		options: {
			lockId: string | null;
			rollbackOfId?: string;
			userId: string | null;
		},
	): Promise<WriteResult> {
		const lock = await project.currentLock();
		if (lock && lock.lockId !== options.lockId) {
			return { lock, ok: false, reason: "locked" };
		}
		const summary = summarizeState(body);
		const id = crypto.randomUUID();
		const objectKey = stateObjectKey({
			id,
			prefix: project.prefix,
			serial: summary.serial,
			slug: project.slug,
		});
		await (await this.#client(project)).putObject(
			project.bucket,
			objectKey,
			body,
			"application/json",
		);
		const version = await IacStateVersionDTO.create({
			createdAt: new Date(),
			id,
			lineage: summary.lineage,
			md5: createHash("md5").update(body).digest("hex"),
			objectKey,
			projectId: project.id,
			rollbackOfId: options.rollbackOfId ?? null,
			serial: summary.serial,
			sizeBytes: Buffer.byteLength(body),
			userId: options.userId,
		});
		return { ok: true, version };
	}

	/**
	 * Takes the state lock with the lock info Terraform sends (its `ID` is
	 * the lock id), unless someone else holds it.
	 *
	 * @throws When the lock info has no id.
	 */
	async lock(
		project: IacProjectDTO,
		info: Record<string, unknown>,
		userId: string | null,
	): Promise<LockResult> {
		const lockId = typeof info.ID === "string" ? info.ID : null;
		if (!lockId) {
			throw new Error("The lock request has no ID.");
		}
		const lock = await project.lock({ info, lockId, userId });
		return { lock, ok: lock.lockId === lockId };
	}

	/**
	 * Releases the state lock when `lockId` matches it, or whatever holds it
	 * with `force`.
	 *
	 * @returns The lock that stays in place when `lockId` didn't match, null
	 *   once the state is unlocked.
	 */
	async unlock(
		project: IacProjectDTO,
		lockId: string | null,
		force = false,
	): Promise<IacStateLock | null> {
		const lock = await project.currentLock();
		if (!lock) {
			return null;
		}
		if (!force && lockId !== lock.lockId) {
			return lock;
		}
		await project.unlock();
		return null;
	}

	/**
	 * What a version changed compared with the one written before it.
	 *
	 * @throws When the version is missing or a body can't be read.
	 */
	async diff(project: IacProjectDTO, versionId: string): Promise<VersionDiff> {
		const version = await IacStateVersionDTO.get(project.id, versionId);
		if (!version) {
			throw new Error("That state version doesn't exist.");
		}
		const previous = await IacStateVersionDTO.previous(version);
		const [after, before] = await Promise.all([
			this.body(project, version),
			previous ? this.body(project, previous) : Promise.resolve(null),
		]);
		return {
			diff: diffStates(
				before === null ? null : summarizeState(before),
				summarizeState(after),
			),
			previousSerial: previous?.serial ?? null,
			serial: version.serial,
		};
	}

	/**
	 * Writes an earlier version back as the newest one, with the serial
	 * bumped past the latest so Terraform accepts it.
	 *
	 * @throws When the state is locked, or the version is missing.
	 */
	async rollback(
		project: IacProjectDTO,
		versionId: string,
		userId: string,
	): Promise<IacStateVersionDTO> {
		if (await project.currentLock()) {
			throw new Error(
				"The state is locked by a running Terraform. Wait for it, or force-unlock first.",
			);
		}
		const [target, latest] = await Promise.all([
			IacStateVersionDTO.get(project.id, versionId),
			IacStateVersionDTO.latest(project.id),
		]);
		if (!(target && latest)) {
			throw new Error("That state version doesn't exist.");
		}
		const body = withSerial(
			await this.body(project, target),
			latest.serial + 1,
		);
		const result = await this.write(project, body, {
			lockId: null,
			rollbackOfId: target.id,
			userId,
		});
		if (!result.ok) {
			throw new Error("The state got locked while rolling back. Try again.");
		}
		return result.version;
	}
}

export const IacStateService = new IacStateServiceClass();
