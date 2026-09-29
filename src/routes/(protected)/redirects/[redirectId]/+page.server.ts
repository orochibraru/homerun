import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RedirectDTO } from "$lib/dto/redirect-dto";
import { Logger } from "$lib/logger";
import { parseRedirectForm } from "$lib/server/redirect-form";
import { RedirectService } from "$lib/services/redirect.service";

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
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const found = await RedirectDTO.get(params.redirectId);
		if (!found) {
			return fail(404, { error: "Redirect not found." });
		}

		const result = await parseRedirectForm(
			await request.formData(),
			params.redirectId,
		);
		if ("error" in result) {
			return fail(400, { error: result.error });
		}

		await found.update(result.fields);
		await RedirectService.sync();
		logger.info(
			`Redirect updated: redirect=${params.redirectId} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
