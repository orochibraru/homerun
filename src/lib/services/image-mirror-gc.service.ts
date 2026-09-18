import { JobDTO } from "$lib/dto/job-dto";
import { listMirrorReferences } from "$lib/dto/mirror-reference-dto";
import { Logger } from "$lib/logger";
import {
	MIRROR_CONFIG_PATH,
	MIRROR_CONTAINER_NAME,
	MIRROR_HOST_PORT,
	MIRROR_INTERNAL_PORT,
	MIRROR_REPOSITORIES_DIR,
	MIRROR_STORAGE_DIR,
} from "./docker/image-scan-refs.ts";
import {
	type MirrorGcPlan,
	type MirrorKeepSet,
	type MirrorRegistryClient,
	type MirrorTag,
	mirrorKeepSet,
	planMirrorGc,
} from "./docker/mirror-registry.ts";
import { DockerService } from "./docker.service.ts";

const logger = new Logger("MirrorGC");

const lockState = globalThis as unknown as { __mirror_gc_running?: boolean };

export interface MirrorUsage {
	collecting: boolean;
	running: boolean;
	sizeBytes: number | null;
}

export interface MirrorGcSpec {
	configPath: string;
	container: string;
	keep: MirrorKeepSet;
	password: string;
	repositoriesDir: string;
	storageDir: string;
	urls: string[];
	username: string;
}

export interface MirrorGcResult {
	itemsDeleted: number;
	keptManifests: number;
	removedRepositories: number;
	spaceReclaimedBytes: number;
}

class ImageMirrorGcServiceClass {
	/** Whether a garbage-collection pass is currently in progress. */
	get running(): boolean {
		return lockState.__mirror_gc_running === true;
	}

	/** The mirror registry's running state and current disk usage, plus whether a GC job is queued or running. */
	async usage(): Promise<MirrorUsage> {
		const [running, job] = await Promise.all([
			DockerService.imageMirrorRunning(),
			JobDTO.findActive("docker_cleanup", "docker-cleanup:pruneMirror"),
		]);
		return {
			collecting: this.running || job !== null,
			running,
			sizeBytes: running ? await DockerService.imageMirrorUsageBytes() : null,
		};
	}

	/** Why cleanup shouldn't run right now (a deploy or scan job may be pulling through the mirror), or null when it's safe to proceed. */
	async busyReason(): Promise<string | null> {
		const active = await JobDTO.countByTypes(
			["deploy", "image_scan"],
			["running"],
		);
		return active > 0
			? `${active} deploy or scan job(s) are running and may be using the mirror.`
			: null;
	}

	/**
	 * Resolves what the Go worker needs to garbage-collect the mirror: makes
	 * sure the mirror is up and configured, then hands over its container,
	 * the registry API addresses to try, its internal credentials and the
	 * keep set.
	 *
	 * @throws When the mirror container isn't running, or when a deploy/scan
	 *   job is currently using it (see `busyReason`).
	 */
	async spec(): Promise<MirrorGcSpec> {
		if (!(await DockerService.imageMirrorRunning())) {
			throw new Error(
				`${MIRROR_CONTAINER_NAME} isn't running, nothing to clean up.`,
			);
		}
		const busy = await this.busyReason();
		if (busy) {
			throw new Error(`Mirror cleanup skipped: ${busy}`);
		}
		await DockerService.ensureImageMirror();
		const auth = await DockerService.registryInternalAuth();
		return {
			configPath: MIRROR_CONFIG_PATH,
			container: MIRROR_CONTAINER_NAME,
			keep: mirrorKeepSet(await listMirrorReferences()),
			password: auth?.password ?? "",
			repositoriesDir: MIRROR_REPOSITORIES_DIR,
			storageDir: MIRROR_STORAGE_DIR,
			urls: [
				`http://127.0.0.1:${MIRROR_HOST_PORT}`,
				`http://${MIRROR_CONTAINER_NAME}:${MIRROR_INTERNAL_PORT}`,
			],
			username: auth?.username ?? "",
		};
	}

	/** Walks every repository in the mirror registry's catalog and collects their full tag inventory. */
	async #inventory(client: MirrorRegistryClient): Promise<{
		inventory: MirrorTag[];
		repositories: string[];
	}> {
		const repositories = await client.catalog();
		const inventory: MirrorTag[] = [];
		for (const repository of repositories) {
			// biome-ignore lint/performance/noAwaitInLoops: repositories are walked one at a time to keep the registry quiet
			inventory.push(...(await client.inventory(repository)));
		}
		return { inventory, repositories };
	}

	/**
	 * Applies a GC plan against the mirror registry: re-tags every manifest
	 * that must be pinned, then deletes every manifest the plan marked for
	 * removal.
	 *
	 * @returns The number of manifests actually deleted.
	 */
	async #apply(
		client: MirrorRegistryClient,
		plan: MirrorGcPlan,
	): Promise<number> {
		for (const pin of plan.pins) {
			// biome-ignore lint/performance/noAwaitInLoops: manifest writes are applied in order
			const pinned = await client.tagManifest(pin);
			if (pinned) {
				logger.info(`Kept ${pin.repository}@${pin.digest} as :${pin.tag}`);
			}
		}
		let deleted = 0;
		for (const entry of plan.deletes) {
			// biome-ignore lint/performance/noAwaitInLoops: manifest deletes are applied in order
			if (await client.deleteManifest(entry)) {
				deleted += 1;
				logger.info(`Deleted ${entry.repository}@${entry.digest}`);
			}
		}
		return deleted;
	}

	/**
	 * Runs one garbage-collection pass over the mirror registry, guarded by a
	 * process-global lock so only one collection runs at a time.
	 *
	 * @throws When a collection is already running.
	 */
	async collect(): Promise<MirrorGcResult> {
		if (this.running) {
			throw new Error("The mirror is already being cleaned up.");
		}
		lockState.__mirror_gc_running = true;
		try {
			return await this.#collect();
		} finally {
			lockState.__mirror_gc_running = false;
		}
	}

	/**
	 * Computes and applies the GC plan: inventories the mirror, plans which
	 * manifests to keep versus delete against every referenced image, deletes
	 * the losers, then triggers the mirror registry's own storage GC, removes
	 * emptied repositories, and restarts the mirror container.
	 *
	 * @throws When the mirror container isn't running, or when a deploy/scan
	 *   job is currently using it (see `busyReason`).
	 */
	async #collect(): Promise<MirrorGcResult> {
		if (!(await DockerService.imageMirrorRunning())) {
			throw new Error(
				`${MIRROR_CONTAINER_NAME} isn't running, nothing to clean up.`,
			);
		}
		const busy = await this.busyReason();
		if (busy) {
			throw new Error(`Mirror cleanup skipped: ${busy}`);
		}

		await DockerService.ensureImageMirror();
		const before = await DockerService.imageMirrorUsageBytes();
		const client = await DockerService.imageMirrorClient();
		const { inventory, repositories } = await this.#inventory(client);
		const plan = planMirrorGc(
			inventory,
			repositories,
			mirrorKeepSet(await listMirrorReferences()),
		);
		logger.info(
			`Mirror cleanup: ${repositories.length} repositories, ${inventory.length} tags, ${plan.deletes.length} manifests to delete, ${plan.keptManifests} to keep.`,
		);

		const deleted = await this.#apply(client, plan);
		await DockerService.garbageCollectImageMirror();
		await DockerService.removeImageMirrorRepositories(plan.emptiedRepositories);
		await DockerService.restartImageMirror();

		const after = await DockerService.imageMirrorUsageBytes();
		const result: MirrorGcResult = {
			itemsDeleted: deleted,
			keptManifests: plan.keptManifests,
			removedRepositories: plan.emptiedRepositories.length,
			spaceReclaimedBytes:
				before !== null && after !== null ? Math.max(0, before - after) : 0,
		};
		logger.info(
			`Mirror cleanup done: deleted ${result.itemsDeleted} manifests, removed ${result.removedRepositories} repositories, kept ${result.keptManifests}, reclaimed ${result.spaceReclaimedBytes} bytes.`,
		);
		return result;
	}
}

export const ImageMirrorGcService = new ImageMirrorGcServiceClass();
