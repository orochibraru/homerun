import { ErrorSourceMapDTO } from "#lib/dto/error-source-map-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { readSourceMapUpload } from "#lib/server/source-map-upload.js";
import { sourceMapReleaseParam } from "#lib/server/validation/api.js";

const logger = new Logger("ErrorTracking");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	return Response.json(await ErrorSourceMapDTO.releases(svc.id));
};

export const POST = async ({ params, locals, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const formData = await request.formData().catch(() => null);
	if (!formData) {
		return Response.json(
			{ error: "Send the maps as multipart/form-data." },
			{ status: 400 },
		);
	}
	const upload = await readSourceMapUpload(formData);
	if (upload.error !== null) {
		return Response.json({ error: upload.error }, { status: 400 });
	}
	await ErrorSourceMapDTO.store(svc.id, upload.release, upload.files);
	logger.info(
		`Source maps uploaded: service=${svc.id} release=${upload.release} files=${upload.files.length} user=${locals.user.id}`,
	);
	return Response.json(
		{ files: upload.files.map((file) => file.name), release: upload.release },
		{ status: 201 },
	);
};

export const DELETE = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const release = sourceMapReleaseParam.safeParse(
		url.searchParams.get("release") ?? "",
	);
	if (!release.success) {
		return Response.json(
			{ error: "Pass the release to delete as ?release=." },
			{ status: 400 },
		);
	}
	const deleted = await ErrorSourceMapDTO.deleteRelease(svc.id, release.data);
	return Response.json({ deleted, release: release.data });
};
