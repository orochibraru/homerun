import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { enqueueVolumeBackup } from "$lib/services/backup-queue";

const logger = new Logger("Backups");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const [volumes, runs, destinations] = await Promise.all([
		StorageVolumeDTO.list(user.id),
		BackupRunDTO.listForUser(user.id),
		S3DestinationDTO.list(user.id),
	]);
	const destinationNames = new Map(destinations.map((d) => [d.id, d.name]));

	return {
		runs: runs.map(({ run, volumeName }) => ({
			...run.toJSON(),
			volumeName,
		})),
		volumes: volumes.map((v) => ({
			destinationName: v.s3DestinationId
				? (destinationNames.get(v.s3DestinationId) ?? "unknown destination")
				: "no destination",
			...v.toJSON(),
		})),
	};
};

export const actions = {
	run: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const volumeId = (formData.get("volumeId") as string | null)?.trim();
		if (!volumeId) {
			return fail(400, { error: "Missing volume id." });
		}

		const volume = await StorageVolumeDTO.get(volumeId, locals.user.id);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}

		await volume.update({ backupLastRunAt: new Date() });
		const entry = await enqueueVolumeBackup(volume);
		logger.info(`Manual backup queued: volume=${volume.id} job=${entry.id}`);
		return { success: true };
	},
};
