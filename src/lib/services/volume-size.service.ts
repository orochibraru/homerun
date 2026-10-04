import { WorkerClient } from "#lib/server/worker-client.js";
import {
	VOLUME_HELPER_IMAGE,
	VOLUME_HELPER_TAG,
} from "./backup/volume-services.ts";

/** How long a measured size is reused before `du` runs again. */
const CACHE_MS = 10 * 60 * 1000;

/** A volume's measured size, or why it couldn't be measured. */
export interface VolumeSize {
	bytes: number | null;
	error: string | null;
	measuredAt: Date;
}

interface WorkerVolumeSize {
	bytes: number | null;
	error?: string;
	source: string;
}

/**
 * How much each volume or host path holds on disk, measured by the worker
 * with `du` in a read-only helper container, the same way for named volumes
 * and bind mounts. Measuring a large volume reads its whole tree, so results
 * are kept for ten minutes.
 */
class VolumeSizeServiceClass {
	#cache = new Map<string, VolumeSize>();

	/**
	 * The size of each source, keyed by source. Fresh cached sizes are reused;
	 * the rest are measured in one worker call. A worker that can't be reached
	 * reports every uncached source as failed rather than throwing.
	 */
	async sizes(
		sources: string[],
		now = new Date(),
	): Promise<Map<string, VolumeSize>> {
		const unique = [...new Set(sources)];
		const stale = unique.filter((source) => {
			const cached = this.#cache.get(source);
			return !cached || now.getTime() - cached.measuredAt.getTime() > CACHE_MS;
		});
		if (stale.length > 0) {
			const measured = await WorkerClient.post<WorkerVolumeSize[]>(
				"/v1/volumes/sizes",
				{
					image: `${VOLUME_HELPER_IMAGE}:${VOLUME_HELPER_TAG}`,
					sources: stale,
				},
			).catch((err: unknown) =>
				stale.map((source) => ({
					bytes: null,
					error: err instanceof Error ? err.message : String(err),
					source,
				})),
			);
			for (const row of measured) {
				this.#cache.set(row.source, {
					bytes: row.bytes,
					error: row.error ?? null,
					measuredAt: now,
				});
			}
		}
		return new Map(
			unique.flatMap((source) => {
				const size = this.#cache.get(source);
				return size ? [[source, size] as const] : [];
			}),
		);
	}

	/** Forgets a source's size, after a backup restore or a wipe changed it. */
	forget(source: string): void {
		this.#cache.delete(source);
	}
}

export const VolumeSizeService = new VolumeSizeServiceClass();
