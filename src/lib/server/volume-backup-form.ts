import { S3DestinationDTO } from "#lib/dto/s3-destination-dto.js";
import type { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { VolumeServices } from "#lib/services/backup/volume-services.js";
import { CronService } from "#lib/services/cron.service.js";

export interface VolumeBackupGuardFields {
	backupPreCommand: string | null;
	backupPreCommandServiceId: string | null;
	backupStopServices: boolean;
}

/**
 * Checks a volume's stop-services and pre-backup command settings. The
 * picked service is dropped when there's no command, and must be one the
 * volume is actually mounted into.
 */
export async function volumeBackupGuard(
	input: {
		backupPreCommand: string | null;
		backupPreCommandServiceId: string | null;
		backupStopServices: boolean;
	},
	volume: StorageVolumeDTO,
): Promise<
	| { error: string; fields: null }
	| { error: null; fields: VolumeBackupGuardFields }
> {
	const backupPreCommand = input.backupPreCommand?.trim() || null;
	const backupPreCommandServiceId = backupPreCommand
		? input.backupPreCommandServiceId?.trim() || null
		: null;
	if (backupPreCommandServiceId) {
		const services = await VolumeServices.servicesUsing(volume);
		if (!services.some((service) => service.id === backupPreCommandServiceId)) {
			return {
				error: "Pick a service this volume is mounted into.",
				fields: null,
			};
		}
	}
	return {
		error: null,
		fields: {
			backupPreCommand,
			backupPreCommandServiceId,
			backupStopServices: input.backupStopServices,
		},
	};
}

export const DEFAULT_BACKUP_SCHEDULE = "0 3 * * *";

/**
 * Why a volume's backup settings can't be saved, or null: an enabled backup
 * needs a valid schedule and a destination, and a destination has to exist.
 */
export async function backupConfigError(input: {
	enabled: boolean;
	s3DestinationId: string | null;
	schedule: string | null;
}): Promise<string | null> {
	if (input.enabled && !CronService.parseCronSchedule(input.schedule ?? "")) {
		return "Invalid schedule : pick one, or use standard 5-field cron.";
	}
	if (input.enabled && !input.s3DestinationId) {
		return "Pick a backup destination.";
	}
	if (
		input.s3DestinationId &&
		!(await S3DestinationDTO.get(input.s3DestinationId))
	) {
		return "That backup destination wasn't found.";
	}
	return null;
}
