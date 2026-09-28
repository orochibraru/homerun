import { json } from "@sveltejs/kit";
import { ErrorSourceMapDTO } from "$lib/dto/error-source-map-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { readSourceMapUpload } from "$lib/server/source-map-upload";
import { sourceMapReleaseParam } from "$lib/server/validation/api";

const logger = new Logger("ErrorTracking");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	return json(await ErrorSourceMapDTO.releases(svc.id));
};

export const POST = async ({ params, locals, platform, request }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const formData = await request.formData().catch(() => null);
	if (!formData) {
		return json(
			{ error: "Send the maps as multipart/form-data." },
			{ status: 400 },
		);
	}
	const upload = await readSourceMapUpload(formData);
	if (upload.error !== null) {
		return json({ error: upload.error }, { status: 400 });
	}
	await ErrorSourceMapDTO.store(svc.id, upload.release, upload.files);
	logger.info(
		`Source maps uploaded: service=${svc.id} release=${upload.release} files=${upload.files.length} user=${locals.user.id}`,
	);
	return json(
		{ files: upload.files.map((file) => file.name), release: upload.release },
		{ status: 201 },
	);
};

export const DELETE = async ({ params, locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const release = sourceMapReleaseParam.safeParse(
		url.searchParams.get("release") ?? "",
	);
	if (!release.success) {
		return json(
			{ error: "Pass the release to delete as ?release=." },
			{ status: 400 },
		);
	}
	const deleted = await ErrorSourceMapDTO.deleteRelease(svc.id, release.data);
	return json({ deleted, release: release.data });
};
