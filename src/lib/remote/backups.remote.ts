import { z } from "zod";
import { query } from "$app/server";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { requireUser } from "$lib/server/remote-auth";
import {
	type BackupObject,
	S3BackupService,
} from "$lib/services/s3-backup.service";

/** What's actually in the bucket for this volume : listed on demand, since it's a network round-trip the page shouldn't wait on to render. */
export const getVolumeBackups = query(
	z.string(),
	async (volumeId): Promise<BackupObject[]> => {
		const user = requireUser();
		const volume = await StorageVolumeDTO.get(volumeId, user.id);
		if (!volume?.s3DestinationId) {
			return [];
		}
		return await S3BackupService.listBackups(volume);
	},
);
