import { error } from "@sveltejs/kit";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";

export const load = async ({ params, parent }) => {
	await parent();
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		error(404, "Volume not found");
	}
	return { volume: volume.toJSON() };
};
