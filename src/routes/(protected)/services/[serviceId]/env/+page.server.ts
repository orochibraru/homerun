import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { HOST_ACCESS_MESSAGE, hostAccessChanged } from "$lib/host-access";
import { Logger } from "$lib/logger";
import {
	parseEnvVars,
	updateEnvFilesSchema,
} from "$lib/server/validation/service";

const logger = new Logger("Services");

export const load = ({ locals }) => ({ isAdmin: locals.isAdmin });

export const actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		await svc.update({ envVars: parseEnvVars(formData) });

		logger.info(`Env vars updated: service=${svc.id} user=${locals.user.id}`);
		return { success: true };
	},
	updateEnvFiles: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updateEnvFilesSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				envFilesError: result.error.issues[0]?.message ?? "Invalid path.",
			});
		}
		if (!locals.isAdmin && hostAccessChanged(svc.toJSON(), result.data)) {
			return fail(403, { envFilesError: HOST_ACCESS_MESSAGE });
		}
		await svc.update({ envFiles: result.data.envFiles });

		logger.info(
			`Env files updated: service=${svc.id} count=${result.data.envFiles.length} user=${locals.user.id}`,
		);
		return { envFilesSaved: true };
	},
};
