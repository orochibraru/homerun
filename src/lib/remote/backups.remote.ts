import { query } from "$app/server";
import { error } from "@sveltejs/kit";
import { z } from "zod";

import { S3DestinationDTO } from "#lib/dto/s3-destination-dto.js";
import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import type { RemoteRepository } from "#lib/services/backup/rclone.js";
import {
	type BackupObject,
	S3BackupService,
} from "#lib/services/s3-backup.service.js";

/** What's actually in the bucket for this volume : listed on demand, since it's a network round-trip the page shouldn't wait on to render. */
export const getVolumeBackups = query(
	z.string(),
	async (volumeId): Promise<BackupObject[]> => {
		requirePermission("storage", "read");
		const volume = await StorageVolumeDTO.get(volumeId);
		if (!volume?.s3DestinationId) {
			return [];
		}
		return await S3BackupService.listBackups(volume);
	},
);

/**
 * The restic repositories on a destination whose volume no longer exists,
 * listed on demand: it walks the destination, which the page shouldn't wait
 * on to render.
 *
 * @throws A 502 error with the reason when the destination can't be listed.
 */
export const getOrphanBackups = query(
	z.string(),
	async (destinationId): Promise<RemoteRepository[]> => {
		requirePermission("storage", "read");
		const row = await S3DestinationDTO.get(destinationId);
		if (!row) {
			return [];
		}
		try {
			return await S3BackupService.orphanRepositories(row);
		} catch (err) {
			error(502, err instanceof Error ? err.message : String(err));
		}
	},
);
