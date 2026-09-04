import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { AppLogDTO } from "$lib/dto/app-log-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Services");

export const load = async ({ params }) => {
	const [failedDeployments, appLogs] = await Promise.all([
		DeploymentDTO.listFailedForService(params.serviceId),
		AppLogDTO.listForService(params.serviceId),
	]);

	return {
		appLogs: appLogs.map((l) => l.toJSON()),
		failedDeployments: failedDeployments.map((d) => d.toJSON()),
	};
};

export const actions = {
	resolveOrphan: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
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
