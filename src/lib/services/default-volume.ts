import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { dataPathFor } from "$lib/service-link";

/**
 * Gives a new database or cache service a named volume at its engine's data
 * directory (`<slug>-data`), so a redeploy doesn't wipe it. Does nothing for
 * a non-datastore image or a service that already has a mount.
 */
export async function attachDefaultDataVolume(
	svc: { id: string; image: string; slug: string; tag: string },
	userId: string,
): Promise<void> {
	const containerPath = dataPathFor(svc.image, svc.tag);
	if (!containerPath) {
		return;
	}
	if ((await ServiceVolumeDTO.listForService(svc.id)).length > 0) {
		return;
	}
	const name = `${svc.slug}-data`;
	const volume = await StorageVolumeDTO.create({
		description: `Created with ${svc.slug}`,
		kind: "volume",
		name,
		source: name,
		userId,
	});
	await ServiceVolumeDTO.attach({
		containerPath,
		readOnly: false,
		serviceId: svc.id,
		volumeId: volume.id,
	});
}
