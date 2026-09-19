import { JobDTO } from "$lib/dto/job-dto";
import { listMirrorReferences } from "$lib/dto/mirror-reference-dto";
import {
	MIRROR_CONFIG_PATH,
	MIRROR_CONTAINER_NAME,
	MIRROR_HOST_PORT,
	MIRROR_INTERNAL_PORT,
	MIRROR_REPOSITORIES_DIR,
	MIRROR_STORAGE_DIR,
} from "./docker/image-scan-refs.ts";
import { type MirrorKeepSet, mirrorKeepSet } from "./docker/mirror-registry.ts";
import { DockerService } from "./docker.service.ts";

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
}

export const ImageMirrorGcService = new ImageMirrorGcServiceClass();
