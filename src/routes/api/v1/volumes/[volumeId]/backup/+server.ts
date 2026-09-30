import { json } from "@sveltejs/kit";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { enqueueVolumeBackup } from "$lib/services/backup-queue";

const logger = new Logger("API");

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		return json({ error: "Not found" }, { status: 404 });
	}
	if (!volume.s3DestinationId) {
		return json(
			{ error: "This volume has no destination to back up to." },
			{ status: 400 },
		);
	}
	await volume.update({ backupLastRunAt: new Date() });
	const entry = await enqueueVolumeBackup(volume);
	logger.info(
		`Backup queued via API: volume=${volume.id} job=${entry.id} user=${locals.user.id}`,
	);
	return json({ jobId: entry.id }, { status: 202 });
};
