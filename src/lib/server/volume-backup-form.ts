import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { VolumeServices } from "$lib/services/backup/volume-services";
import { CronService } from "$lib/services/cron.service";

export interface VolumeBackupGuardFields {
	backupPreCommand: string | null;
	backupPreCommandServiceId: string | null;
	backupStopServices: boolean;
}

/**
 * Reads the backup form's stop-services and pre-backup command fields. The
 * picked service is dropped when there's no command, and must be one the
 * volume is actually mounted into.
 */
export async function parseVolumeBackupGuard(
	formData: FormData,
	volume: StorageVolumeDTO,
): Promise<
	| { error: string; fields: null }
	| { error: null; fields: VolumeBackupGuardFields }
> {
	const backupPreCommand =
		(formData.get("backupPreCommand") as string | null)?.trim() || null;
	const pickedServiceId =
		(formData.get("backupPreCommandServiceId") as string | null)?.trim() ||
		null;
	const backupPreCommandServiceId = backupPreCommand ? pickedServiceId : null;
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
			backupStopServices: formData.get("backupStopServices") === "on",
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
		return "Pick an S3 destination.";
	}
	if (
		input.s3DestinationId &&
		!(await S3DestinationDTO.get(input.s3DestinationId))
	) {
		return "That S3 destination wasn't found.";
	}
	return null;
}
