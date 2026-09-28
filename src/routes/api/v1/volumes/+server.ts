import { json } from "@sveltejs/kit";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";
import { nextCronRun } from "$lib/services/cron/cron-expression";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const paged = await StorageVolumeDTO.listPaged(
		parseApiListQuery(url, ["kind", "backup"]),
	);
	const now = new Date();
	return jsonPage(
		paged.items.map((volume) => {
			const row = volume.toJSON();
			return {
				...row,
				backupNextRunAt:
					row.backupEnabled && row.backupSchedule
						? nextCronRun(row.backupSchedule, now)
						: null,
			};
		}),
		paged,
	);
};
