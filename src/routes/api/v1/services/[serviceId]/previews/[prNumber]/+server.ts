import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { deployPreviewApiBody } from "#lib/server/validation/api.js";
import { PreviewApiService } from "#lib/services/preview-api.service.js";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const prNumber = Number(params.prNumber);
	if (!(Number.isInteger(prNumber) && prNumber > 0)) {
		return Response.json(
			{ error: "Not a pull request number." },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const preview = await PreviewApiService.get(svc, prNumber);
	if (!preview) {
		return Response.json(
			{ error: `There's no preview for #${prNumber}.` },
			{ status: 404 },
		);
	}
	return Response.json(preview);
};

export const DELETE = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const prNumber = Number(params.prNumber);
	if (!(Number.isInteger(prNumber) && prNumber > 0)) {
		return Response.json(
			{ error: "Not a pull request number." },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	try {
		if (!(await PreviewApiService.delete(svc, prNumber))) {
			return Response.json(
				{ error: `There's no preview for #${prNumber}.` },
				{ status: 404 },
			);
		}
	} catch (err) {
		logger.warn(
			`Couldn't delete preview via API: service=${svc.id} pr=${prNumber}`,
			err,
		);
		return Response.json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 409 },
		);
	}
	logger.info(
		`Preview deleted via API: service=${svc.id} pr=${prNumber} user=${locals.user.id}`,
	);
	return Response.json({ success: true });
};

export const PUT = async ({ params, locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const prNumber = Number(params.prNumber);
	if (!(Number.isInteger(prNumber) && prNumber > 0)) {
		return apiError("Not a pull request number.");
	}
	const service = await ServiceDTO.get(params.serviceId);
	if (!service) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, deployPreviewApiBody);
	if ("response" in body) {
		return body.response;
	}
	const result = await PreviewApiService.deploy(service, {
		branch: body.data.branch ?? null,
		commit: body.data.commit ?? null,
		prNumber,
		tag: body.data.tag,
		title: body.data.title ?? null,
	});
	if (result.error !== null) {
		return apiError(result.error, result.status);
	}
	logger.info(
		`Preview deployed via API: service=${service.id} pr=${prNumber} tag=${body.data.tag} deployment=${result.deploymentId} user=${caller.userId}`,
	);
	return Response.json(
		{ ...result.preview, deploymentId: result.deploymentId },
		{ status: 202 },
	);
};
