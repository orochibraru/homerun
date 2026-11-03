import { fail } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { can } from "#lib/permissions.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import {
	ServiceSettingsError,
	ServiceSettingsService,
} from "#lib/services/service-settings.service.js";

const logger = new Logger("Services");

export const actions = {
	updateAutoRollback: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const formData = await request.formData();
		const autoRollback = formData.get("autoRollback") === "on";
		await svc.update({ autoRollback });
		logger.info(
			`Auto-rollback updated: service=${svc.id} enabled=${autoRollback} user=${locals.user.id}`,
		);
		return { autoRollbackSaved: true };
	},

	updateImageScan: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const formData = await request.formData();
		const imageScanEnabled = formData.get("imageScanEnabled") === "on";
		await svc.update({ imageScanEnabled });
		logger.info(
			`Image scanning updated: service=${svc.id} enabled=${imageScanEnabled} user=${locals.user.id}`,
		);
		return { imageScanSaved: true };
	},

	updateCron: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const cronEnabled = formData.get("cronEnabled") === "on";
		const cronSchedule =
			(formData.get("cronSchedule") as string | null)?.trim() ?? "";

		const saved = await ServiceSettingsService.save(
			svc,
			{ cronEnabled, cronSchedule: cronSchedule || null },
			{
				hostAccess: can(locals.permissions, "system", "write"),
				userId: locals.user.id,
			},
		);
		if (saved instanceof ServiceSettingsError) {
			return fail(saved.status, { cronError: saved.message });
		}
		logger.info(
			`Cron schedule updated: service=${svc.id} enabled=${cronEnabled} schedule="${cronSchedule}" user=${locals.user.id}`,
		);

		return { cronSaved: true };
	},
};
