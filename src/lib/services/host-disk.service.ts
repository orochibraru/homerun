import { WorkerClient } from "#lib/server/worker-client.js";

import {
	VOLUME_HELPER_IMAGE,
	VOLUME_HELPER_TAG,
} from "./backup/volume-services.ts";

/** How long the host's disk list is reused before the worker reads it again. */
const CACHE_MS = 60 * 1000;

/** One filesystem mounted on the host that a Docker volume can be placed on. */
export interface HostDisk {
	device: string;
	filesystem: string;
	freeBytes: number;
	mountPoint: string;
	totalBytes: number;
}

/**
 * The host's disks, read by the worker from a helper container that mounts
 * the host's root, and placing a Docker volume on one of them.
 */
class HostDiskServiceClass {
	#cache: { at: number; disks: HostDisk[] } | null = null;

	/**
	 * The host's disk filesystems, root first, cached for a minute. A worker
	 * that can't be reached throws.
	 */
	async list(now = Date.now()): Promise<HostDisk[]> {
		if (this.#cache && now - this.#cache.at < CACHE_MS) {
			return this.#cache.disks;
		}
		const disks = await WorkerClient.get<HostDisk[]>("/v1/disks", {
			image: `${VOLUME_HELPER_IMAGE}:${VOLUME_HELPER_TAG}`,
		});
		this.#cache = { at: now, disks };
		return disks;
	}

	/**
	 * Creates the named Docker volume on `disk` (a host mount point), its data
	 * in `<disk>/homerun-volumes/<name>`. A volume that already exists is left
	 * where it is.
	 *
	 * @throws When the worker can't create its directory or the volume.
	 */
	async place(name: string, disk: string): Promise<void> {
		await WorkerClient.post("/v1/volumes/on-disk", {
			disk,
			image: `${VOLUME_HELPER_IMAGE}:${VOLUME_HELPER_TAG}`,
			name,
		});
	}
}

export const HostDiskService = new HostDiskServiceClass();
