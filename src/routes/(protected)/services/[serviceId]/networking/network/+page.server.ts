import { fail } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { can } from "#lib/permissions.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { updatePortsSchema } from "#lib/server/validation/service.js";
import {
	ServiceSettingsError,
	ServiceSettingsService,
} from "#lib/services/service-settings.service.js";

const logger = new Logger("Services");

export const actions = {
	updatePorts: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updatePortsSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				portsValues: Object.fromEntries(formData),
			});
		}
		const input = result.data;
		const saved = await ServiceSettingsService.save(svc, input, {
			hostAccess: can(locals.permissions, "system", "write"),
			userId: locals.user.id,
		});
		if (saved instanceof ServiceSettingsError) {
			return fail(saved.status, { error: saved.message });
		}

		logger.info(
			`Ports updated: service=${svc.id} port=${input.containerPort}/${input.portProtocol} networkMode=${input.networkMode} user=${locals.user.id}`,
		);
		return { portsSuccess: true };
	},
};
