import type { JobDTO } from "$lib/dto/job-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { QueueService } from "./queue.service.ts";

export function enqueueVolumeBackup(volume: StorageVolumeDTO): Promise<JobDTO> {
	return QueueService.enqueue({
		dedupeKey: `backup:${volume.id}`,
		lockKey: `volume:${volume.id}`,
		maxAttempts: 2,
		payload: { userId: volume.userId, volumeId: volume.id },
		title: `Back up ${volume.name}`,
		type: "backup",
		userId: volume.userId,
	});
}
