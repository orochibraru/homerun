import { fail } from "@sveltejs/kit";
import { AppLogDTO } from "#lib/dto/app-log-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { errorDismissal, errorsSince } from "#lib/server/error-dismissal.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";

const logger = new Logger("Services");

export const load = async ({ params, parent, url }) => {
	const { service: svc } = await parent();
	const { showDismissed, since } = errorsSince(svc, url);
	const [appLogs, dismissal] = await Promise.all([
		AppLogDTO.listForService(params.serviceId, 50, since),
		errorDismissal(svc, showDismissed, since, (upTo) =>
			AppLogDTO.countForServiceUpTo(params.serviceId, upTo),
		),
	]);
	return {
		appLogs: appLogs.map((l) => l.toJSON()),
		dismissal,
	};
};

export const actions = {
	clearErrors: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		await svc.dismissErrors(null);
		logger.info(`Errors dismissed: service=${svc.id} user=${locals.user.id}`);
		return { success: true };
	},
};
