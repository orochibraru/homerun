import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { updateHealthSchema } from "$lib/server/validation/service";
import { HEALTHCHECK_DEFAULTS } from "$lib/services/docker/healthcheck";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("Services");

export const load = async ({ parent }) => {
	const { service } = await parent();
	return {
		applied: service.containerId
			? await DockerService.containerHealthcheck(service.containerId)
			: null,
		defaults: HEALTHCHECK_DEFAULTS,
		swarm: !!service.swarmServiceId,
	};
};

export const actions = {
	updateHealth: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updateHealthSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}
		const input = result.data;

		await svc.update({
			healthcheckCommand: input.healthcheckCommand || null,
			healthcheckDisabled: input.healthcheckDisabled,
			healthcheckIntervalSeconds: input.healthcheckIntervalSeconds ?? null,
			healthcheckRetries: input.healthcheckRetries ?? null,
			healthcheckStartPeriodSeconds:
				input.healthcheckStartPeriodSeconds ?? null,
			healthcheckTimeoutSeconds: input.healthcheckTimeoutSeconds ?? null,
		});

		logger.info(
			`Service healthcheck updated: service=${svc.id} disabled=${input.healthcheckDisabled} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
