import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { PreviewApiService } from "$lib/services/preview-api.service";

const logger = new Logger("API");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const prNumber = Number(params.prNumber);
	if (!(Number.isInteger(prNumber) && prNumber > 0)) {
		return json({ error: "Not a pull request number." }, { status: 400 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const preview = await PreviewApiService.get(svc, prNumber);
	if (!preview) {
		return json(
			{ error: `There's no preview for #${prNumber}.` },
			{ status: 404 },
		);
	}
	return json(preview);
};

export const DELETE = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const prNumber = Number(params.prNumber);
	if (!(Number.isInteger(prNumber) && prNumber > 0)) {
		return json({ error: "Not a pull request number." }, { status: 400 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	try {
		if (!(await PreviewApiService.delete(svc, prNumber))) {
			return json(
				{ error: `There's no preview for #${prNumber}.` },
				{ status: 404 },
			);
		}
	} catch (err) {
		logger.warn(
			`Couldn't delete preview via API: service=${svc.id} pr=${prNumber}`,
			err,
		);
		return json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 409 },
		);
	}
	logger.info(
		`Preview deleted via API: service=${svc.id} pr=${prNumber} user=${locals.user.id}`,
	);
	return json({ success: true });
};
