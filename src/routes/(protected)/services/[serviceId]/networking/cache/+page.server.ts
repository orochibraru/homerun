import { fail } from "@sveltejs/kit";

import { config } from "#lib/config.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";

const logger = new Logger("Services");

export const load = () => ({ httpCacheAvailable: config.traefik.httpCache });

export const actions = {
	updateCache: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const raw = String(
			(await request.formData()).get("httpCacheTtl") ?? "",
		).trim();
		const ttl = raw === "" ? null : Number(raw);
		if (ttl !== null && !(Number.isInteger(ttl) && ttl >= 1 && ttl <= 86_400)) {
			return fail(400, {
				error: "Cache time must be a whole number of seconds, 1 to 86400.",
			});
		}
		await svc.update({ httpCacheTtl: ttl });
		logger.info(
			`Response cache updated: service=${svc.id} ttl=${ttl ?? "off"} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
