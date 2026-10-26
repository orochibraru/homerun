import { fail } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";

const logger = new Logger("Services");

export const actions = {
	resolveOrphan: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		await svc.resolveOrphan();
		logger.info(
			`Orphaned container reference cleared: service=${svc.id} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
