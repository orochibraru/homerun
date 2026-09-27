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

/**
 * Mounts a fresh named volume at each of a template's declared data paths,
 * named like the deploy wizard's new volumes (`<slug>-data`,
 * `<slug>-data-1`, …). Does nothing when the template declares none.
 */
export async function attachTemplateVolumes(
	svc: { id: string; slug: string },
	paths: string[],
	userId: string,
): Promise<void> {
	for (const [index, containerPath] of paths.entries()) {
		const name = index === 0 ? `${svc.slug}-data` : `${svc.slug}-data-${index}`;
		// oxlint-disable-next-line no-await-in-loop -- one volume at a time, each attached before the next is named
		const volume = await StorageVolumeDTO.create({
			description: `Created with ${svc.slug}`,
			kind: "volume",
			name,
			source: name,
			userId,
		});
		// oxlint-disable-next-line no-await-in-loop -- attached to the volume just created
		await ServiceVolumeDTO.attach({
			containerPath,
			readOnly: false,
			serviceId: svc.id,
			volumeId: volume.id,
		});
	}
}
