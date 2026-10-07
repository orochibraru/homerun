import { z } from "zod";
import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import { VolumeSizeService } from "#lib/services/volume-size.service.js";
import { query } from "$app/server";

export interface VolumeSizeRow {
	bytes: number | null;
	error: string | null;
	id: string;
}

export const getVolumeSizes = query(
	z.array(z.string()).max(200),
	async (volumeIds): Promise<VolumeSizeRow[]> => {
		requirePermission("storage", "read");
		if (volumeIds.length === 0) {
			return [];
		}
		const wanted = new Set(volumeIds);
		const volumes = (await StorageVolumeDTO.list()).filter((vol) =>
			wanted.has(vol.id),
		);
		const sizes = await VolumeSizeService.sizes(
			volumes.map((vol) => vol.source),
		);
		return volumes.map((vol) => ({
			bytes: sizes.get(vol.source)?.bytes ?? null,
			error: sizes.get(vol.source)?.error ?? null,
			id: vol.id,
		}));
	},
);
