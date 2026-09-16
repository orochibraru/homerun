import { JobDTO } from "$lib/dto/job-dto";
import { listMirrorReferences } from "$lib/dto/mirror-reference-dto";
import { Logger } from "$lib/logger";
import { MIRROR_CONTAINER_NAME } from "./docker/image-scan-refs.ts";
import {
	type MirrorGcPlan,
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

export interface MirrorGcResult {
	itemsDeleted: number;
	keptManifests: number;
	removedRepositories: number;
	spaceReclaimedBytes: number;
}

class ImageMirrorGcServiceClass {
	get running(): boolean {
		return lockState.__mirror_gc_running === true;
	}

	async usage(): Promise<MirrorUsage> {
		const running = await DockerService.imageMirrorRunning();
		return {
			collecting: this.running,
			running,
			sizeBytes: running ? await DockerService.imageMirrorUsageBytes() : null,
		};
	}

	async busyReason(): Promise<string | null> {
		const active = await JobDTO.countByTypes(
			["deploy", "image_scan"],
			["running"],
		);
		return active > 0
			? `${active} deploy or scan job(s) are running and may be using the mirror.`
			: null;
	}

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
