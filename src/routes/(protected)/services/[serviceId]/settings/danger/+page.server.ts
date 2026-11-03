import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { WorkloadDetachError } from "#lib/services/docker/workload-removal.js";
import {
	ServiceBusyError,
	ServiceLifecycleService,
} from "#lib/services/service-lifecycle.service.js";

const logger = new Logger("Services");

export const load = async ({ params }) => {
	const svc = await ServiceDTO.get(params.serviceId);
	return {
		activeJobs: svc ? await ServiceLifecycleService.activeJobs(svc) : [],
	};
};

export const actions = {
	delete: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const form = await request.formData();
		const force = form.get("force") === "true";
		const deleteVolumes = form.get("deleteVolumes") === "true";
		try {
			await ServiceLifecycleService.deleteService(svc, {
				deleteVolumes,
				force,
			});
		} catch (error) {
			if (
				error instanceof WorkloadDetachError ||
				error instanceof ServiceBusyError
			) {
				return fail(409, { detachFailed: true, error: error.message });
			}
			throw error;
		}

		logger.info(
			`Service deleted: service=${svc.id} force=${force} deleteVolumes=${deleteVolumes} user=${locals.user.id}`,
		);

		throw redirect(303, resolve("services"));
	},
};
