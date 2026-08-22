import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { CronService } from "$lib/services/cron.service";
import { S3BackupService } from "$lib/services/s3-backup.service";

const logger = new Logger("Storage");

export const load = async ({ params, parent }) => {
	const { user } = await parent();
	const volume = await StorageVolumeDTO.get(params.volumeId, user.id);
	if (!volume) {
		error(404, "Volume not found");
	}
	const [runs, destinations] = await Promise.all([
		BackupRunDTO.listForVolume(volume.id),
		S3DestinationDTO.list(user.id),
	]);
	return {
		destinations: destinations.map((d) => d.toJSON()),
		runs: runs.map((r) => r.toJSON()),
		volume: volume.toJSON(),
	};
};

export const actions = {
	backupNow: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const volume = await StorageVolumeDTO.get(params.volumeId, locals.user.id);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}

		const result = await S3BackupService.backupVolume(volume);
		await volume.update({ backupLastRunAt: new Date() });

		if (!result.success) {
			return fail(500, { error: result.error ?? "Backup failed." });
		}
		logger.info(`Manual backup run: volume=${volume.id} key=${result.key}`);
		return { backupKey: result.key, backupSuccess: true };
	},

	updateBackup: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const volume = await StorageVolumeDTO.get(params.volumeId, locals.user.id);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}

		const formData = await request.formData();
		const backupEnabled = formData.get("backupEnabled") === "on";
		const backupSchedule =
			(formData.get("backupSchedule") as string | null)?.trim() || null;
		const s3DestinationId =
			(formData.get("s3DestinationId") as string | null)?.trim() || null;
		const backupPrefix =
			(formData.get("backupPrefix") as string | null)?.trim() || null;

		if (volume.kind !== "bind" && backupEnabled) {
			return fail(400, {
				error: "Only bind-mount volumes can be backed up right now.",
			});
		}
		if (backupEnabled && !CronService.parseCronSchedule(backupSchedule ?? "")) {
			return fail(400, {
				error:
					'Invalid schedule : use standard 5-field cron syntax (e.g. "0 3 * * *").',
			});
		}
		if (backupEnabled && !s3DestinationId) {
			return fail(400, { error: "Pick an S3 destination." });
		}
		if (
			s3DestinationId &&
			!(await S3DestinationDTO.get(s3DestinationId, locals.user.id))
		) {
			return fail(400, { error: "That S3 destination wasn't found." });
		}

		await volume.update({
			backupEnabled,
			backupPrefix,
			backupSchedule,
			s3DestinationId,
		});

		logger.info(
			`Backup config updated: volume=${volume.id} enabled=${backupEnabled} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
