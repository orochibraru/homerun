import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { HOST_ACCESS_MESSAGE, hostAccessChanged } from "$lib/host-access";
import { Logger } from "$lib/logger";
import { updateRuntimeSchema } from "$lib/server/validation/service";

const logger = new Logger("Services");

export const load = async ({ locals }) => {
	const settings = await InstanceSettingsDTO.get();
	return {
		isAdmin: locals.isAdmin,
		orchestrationMode: settings.orchestrationMode,
	};
};

export const actions = {
	updateRuntime: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updateRuntimeSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}

		if (!locals.isAdmin && hostAccessChanged(svc.toJSON(), result.data)) {
			return fail(403, {
				error: HOST_ACCESS_MESSAGE,
				values: Object.fromEntries(formData),
			});
		}

		await svc.update(result.data);

		logger.info(
			`Service runtime settings updated: service=${svc.id} privileged=${result.data.privileged} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
