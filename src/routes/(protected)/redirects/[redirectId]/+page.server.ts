import { error, fail, redirect } from "@sveltejs/kit";
import { RedirectDTO } from "#lib/dto/redirect-dto.js";
import { Logger } from "#lib/logger.js";
import { parseRedirectInput } from "#lib/server/redirect-form.js";
import {
	RedirectService,
	redirectHost,
} from "#lib/services/redirect.service.js";
import { resolve } from "$app/paths";

const logger = new Logger("Redirects");

export const load = async ({ params, parent }) => {
	await parent();

	const found = await RedirectDTO.get(params.redirectId);
	if (!found) {
		error(404, "Redirect not found");
	}

	return { redirect: found.toJSON() };
};

export const actions = {
	update: async ({ params, request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}

		const found = await RedirectDTO.get(params.redirectId);
		if (!found) {
			return fail(404, { error: "Redirect not found." });
		}

		const result = await parseRedirectInput(
			Object.fromEntries(await request.formData()),
			params.redirectId,
		);
		if ("error" in result) {
			return fail(400, { error: result.error });
		}

		const host = redirectHost(found.toJSON().source);
		await found.update(result.fields);
		await RedirectService.sync(host ? [host] : []);
		logger.info(
			`Redirect updated: redirect=${params.redirectId} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
