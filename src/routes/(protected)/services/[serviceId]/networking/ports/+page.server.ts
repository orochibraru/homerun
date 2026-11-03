import { fail } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { can } from "#lib/permissions.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import {
	parseExposedPortsField,
	parsePublishedPortsField,
} from "#lib/server/validation/service.js";
import {
	ServiceSettingsError,
	ServiceSettingsService,
} from "#lib/services/service-settings.service.js";

const logger = new Logger("Services");

export const actions = {
	updatePublishedPorts: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const parsed = parsePublishedPortsField(
			(await request.formData()).get("publishedPorts"),
		);
		if ("error" in parsed) {
			return fail(400, { error: parsed.error });
		}
		const { ports } = parsed;
		const saved = await ServiceSettingsService.save(
			svc,
			{ publishedPorts: ports },
			{
				hostAccess: can(locals.permissions, "system", "write"),
				userId: locals.user.id,
			},
		);
		if (saved instanceof ServiceSettingsError) {
			return fail(saved.status, { error: saved.message });
		}
		logger.info(
			`Published ports updated: service=${svc.id} ports=${ports.map((p) => `${p.hostPort}:${p.containerPort}/${p.protocol}`).join(",") || "none"} user=${locals.user.id}`,
		);
		return { success: true };
	},

	updateExposedPorts: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const parsed = parseExposedPortsField(
			(await request.formData()).get("exposedPorts"),
		);
		if ("error" in parsed) {
			return fail(400, { error: parsed.error });
		}
		const { ports } = parsed;
		const saved = await ServiceSettingsService.save(
			svc,
			{ exposedPorts: ports },
			{
				hostAccess: can(locals.permissions, "system", "write"),
				userId: locals.user.id,
			},
		);
		if (saved instanceof ServiceSettingsError) {
			return fail(saved.status, { error: saved.message });
		}
		logger.info(
			`Exposed ports updated: service=${svc.id} ports=${ports.map((p) => `${p.port}/${p.protocol}`).join(",") || "none"} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
