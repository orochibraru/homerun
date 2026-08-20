import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { CronService } from "$lib/services/cron.service";
import { S3BackupService } from "$lib/services/s3-backup.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Storage");

export const load = async ({ params, parent }) => {
	const { user } = await parent();
	const volume = await StorageVolumeDTO.get(params.volumeId, user.id);
	if (!volume) {
		error(404, "Volume not found");
	}
	return { volume: volume.toJSON() };
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
		const backupEndpoint =
			(formData.get("backupEndpoint") as string | null)?.trim() || null;
		const backupBucket =
			(formData.get("backupBucket") as string | null)?.trim() || null;
		const backupRegion =
			(formData.get("backupRegion") as string | null)?.trim() || null;
		const backupAccessKeyId =
			(formData.get("backupAccessKeyId") as string | null)?.trim() || null;
		const backupSecretAccessKey = (
			formData.get("backupSecretAccessKey") as string | null
		)?.trim();
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
		if (
			backupEnabled &&
			!(backupEndpoint && backupBucket && backupRegion && backupAccessKeyId)
		) {
			return fail(400, {
				error: "Endpoint, bucket, region, and access key are all required.",
			});
		}

		await volume.update({
			backupAccessKeyId,
			backupBucket,
			backupEnabled,
			backupEndpoint,
			backupPrefix,
			backupRegion,
			backupSchedule,
			// Blank means "leave unchanged" : never overwrite a stored secret
			// just because the user didn't retype it (same convention as
			// registryPassword elsewhere).
			...(backupSecretAccessKey
				? { backupSecretAccessKeyEnc: encryptSecret(backupSecretAccessKey) }
				: {}),
		});

		logger.info(
			`Backup config updated: volume=${volume.id} enabled=${backupEnabled} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
