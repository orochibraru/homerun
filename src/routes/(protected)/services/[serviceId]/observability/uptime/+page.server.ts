import { fail } from "@sveltejs/kit";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { UptimeCheckDTO } from "#lib/dto/uptime-check-dto.js";
import { Logger } from "#lib/logger.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import {
	externalHostFor,
	externalProbeSkipReason,
} from "#lib/services/uptime/uptime-probe.js";

const logger = new Logger("Services");

export const load = async ({ params, parent }) => {
	const { service: svc } = await parent();
	const [internal, external] = await Promise.all([
		UptimeCheckDTO.beats(params.serviceId, "internal"),
		UptimeCheckDTO.beats(params.serviceId, "external"),
	]);

	const externalHost = externalHostFor(svc);
	return {
		externalSkipped: externalHost
			? externalProbeSkipReason(externalHost)
			: "This service isn't publicly routed, so there's no hostname to check.",
		uptime: { external, internal },
	};
};

export const actions = {
	setUptime: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const uptimeEnabled = formData.get("uptimeEnabled") === "true";
		await svc.update({ uptimeEnabled });
		logger.info(
			`Uptime probing updated: service=${svc.id} enabled=${uptimeEnabled} user=${locals.user.id}`,
		);
		return { success: true, uptimeEnabled };
	},

	clearHeartbeats: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		await UptimeCheckDTO.clearForService(svc.id);
		logger.info(`Heartbeats cleared: service=${svc.id} user=${locals.user.id}`);
		return { success: true };
	},
};
