import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { VolumeFilesService } from "$lib/services/volume-files.service";
import { MAX_EDITABLE_BYTES, normalizeVolumePath } from "$lib/volume-files";

const logger = new Logger("Storage");

export const load = async ({ params, parent, url }) => {
	await parent();
	const volume = await StorageVolumeDTO.get(params.volumeId);
	if (!volume) {
		error(404, "Volume not found");
	}
	const rawFile = url.searchParams.get("file");
	const path = normalizeVolumePath(url.searchParams.get("path") ?? "");
	const filePath = rawFile === null ? null : normalizeVolumePath(rawFile);
	if (path === null || (rawFile !== null && filePath === null)) {
		return {
			error: "That path leaves the volume.",
			file: null,
			listing: null,
			path: "",
		};
	}

	try {
		if (filePath !== null) {
			const file = await VolumeFilesService.read(volume, filePath);
			return {
				error: null,
				file: { ...file, path: filePath },
				listing: null,
				path,
			};
		}
		const listing = await VolumeFilesService.list(volume, path);
		return { error: null, file: null, listing, path };
	} catch (err) {
		return {
			error: err instanceof Error ? err.message : "Couldn't read the volume.",
			file: null,
			listing: null,
			path,
		};
	}
};

export const actions = {
	save: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const volume = await StorageVolumeDTO.get(params.volumeId);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}
		const formData = await request.formData();
		const path = normalizeVolumePath(String(formData.get("path") ?? ""));
		const content = String(formData.get("content") ?? "");
		if (path === null) {
			return fail(400, { error: "That path leaves the volume." });
		}
		if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_BYTES) {
			return fail(400, { error: "The file is too big to save from here." });
		}
		try {
			await VolumeFilesService.write(volume, path, content);
		} catch (err) {
			return fail(500, {
				error: err instanceof Error ? err.message : "Couldn't save the file.",
			});
		}
		logger.info(
			`Volume file saved: volume=${volume.id} path=/${path} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
