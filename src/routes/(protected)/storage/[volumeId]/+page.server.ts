import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import {
	backupConfigError,
	parseVolumeBackupGuard,
} from "$lib/server/volume-backup-form";
import { VolumeServices } from "$lib/services/backup/volume-services";
import {
	enqueueVolumeBackup,
	enqueueVolumeRestore,
} from "$lib/services/backup-queue";

const logger = new Logger("Storage");

export const load = async ({ params, parent }) => {
	await parent();
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		error(404, "Volume not found");
	}
	const [runs, destinations, services] = await Promise.all([
		BackupRunDTO.listForVolume(volume.id),
		S3DestinationDTO.list(),
		VolumeServices.servicesUsing(volume),
	]);
	return {
		destinations: destinations.map((d) => d.toJSON()),
		runs: runs.map((r) => r.toJSON()),
		services: services.map((service) => ({
			id: service.id,
			name: service.name,
		})),
	};
};

export const actions = {
	backupNow: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const volume = await StorageVolumeDTO.get(params.volumeId);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}

		await volume.update({ backupLastRunAt: new Date() });
		const entry = await enqueueVolumeBackup(volume);
		logger.info(`Manual backup queued: volume=${volume.id} job=${entry.id}`);
		return { backupSuccess: true };
	},

	restore: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const volume = await StorageVolumeDTO.get(params.volumeId);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}
		const formData = await request.formData();
		const key = (formData.get("key") as string | null)?.trim();
		if (!key) {
			return fail(400, { error: "Pick a backup to restore." });
		}

		const options = {
			stopServices: formData.get("stopServices") === "on",
			wipe: formData.get("wipe") === "on",
		};
		const entry = await enqueueVolumeRestore(volume, key, options);
		logger.info(
			`Restore queued: volume=${volume.id} key=${key} wipe=${options.wipe} stopServices=${options.stopServices} job=${entry.id}`,
		);
		return { restoredKey: key, success: true };
	},

	updateBackup: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const volume = await StorageVolumeDTO.get(params.volumeId);
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

		const configError = await backupConfigError({
			enabled: backupEnabled,
			s3DestinationId,
			schedule: backupSchedule,
		});
		if (configError) {
			return fail(400, { error: configError });
		}

		const guard = await parseVolumeBackupGuard(formData, volume);
		if (guard.error !== null) {
			return fail(400, { error: guard.error });
		}

		await volume.update({
			backupEnabled,
			backupPrefix,
			backupSchedule,
			s3DestinationId,
			...guard.fields,
		});

		logger.info(
			`Backup config updated: volume=${volume.id} enabled=${backupEnabled} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
