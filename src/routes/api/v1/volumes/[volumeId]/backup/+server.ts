import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { Logger } from "#lib/logger.js";
import { enqueueVolumeBackup } from "#lib/services/backup-queue.js";

const logger = new Logger("API");

export const POST = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	if (!volume.s3DestinationId) {
		return Response.json(
			{ error: "This volume has no destination to back up to." },
			{ status: 400 },
		);
	}
	await volume.update({ backupLastRunAt: new Date() });
	const entry = await enqueueVolumeBackup(volume);
	logger.info(
		`Backup queued via API: volume=${volume.id} job=${entry.id} user=${locals.user.id}`,
	);
	return Response.json({ jobId: entry.id }, { status: 202 });
};
