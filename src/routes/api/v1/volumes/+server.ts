import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { jsonPage, parseApiListQuery } from "#lib/server/api-pagination.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { volumeApiBody } from "#lib/server/validation/api-resources.js";
import { nextCronRun } from "#lib/services/cron/cron-expression.js";
import {
	VolumeSettingsError,
	VolumeSettingsService,
} from "#lib/services/volume-settings.service.js";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
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

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, volumeApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const volume = await VolumeSettingsService.create(body.data, caller.userId);
		return Response.json(volume.toJSON(), { status: 201 });
	} catch (err) {
		if (err instanceof VolumeSettingsError) {
			return apiError(err.message);
		}
		throw err;
	}
};
