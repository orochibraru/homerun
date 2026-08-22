import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { updateComputeSchema } from "$lib/server/validation/service";

const logger = new Logger("Services");

export const load = async () => {
	const settings = await InstanceSettingsDTO.get();
	return {
		// Just enough to explain *why* the autoscale toggle might not do
		// anything yet (instance-wide autoscaling off, or no overflow host
		// configured) : full config lives on Settings' Autoscaling section.
		autoscale: settings.autoscale,
		orchestrationMode: settings.orchestrationMode,
	};
};

export const actions = {
	updateCompute: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updateComputeSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}
		const input = result.data;

		await svc.update({
			autoscaleEligible: input.autoscaleEligible,
			cpuLimit: input.cpuLimit || null,
			memoryLimitMb: input.memoryLimitMb ?? null,
			replicas: input.replicas ?? 1,
		});

		logger.info(
			`Service compute settings updated: service=${svc.id} autoscaleEligible=${input.autoscaleEligible} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
