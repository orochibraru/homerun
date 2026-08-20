import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { parseEnvVars } from "$lib/server/validation/service";

const logger = new Logger("Services");

export const actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		await svc.update({ envVars: parseEnvVars(formData) });

		logger.info(`Env vars updated: service=${svc.id} user=${locals.user.id}`);
		return { success: true };
	},
};
