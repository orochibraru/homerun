import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { VolumeServices } from "$lib/services/backup/volume-services";

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
