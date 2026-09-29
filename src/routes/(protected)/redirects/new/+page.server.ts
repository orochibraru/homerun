import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RedirectDTO } from "$lib/dto/redirect-dto";
import { Logger } from "$lib/logger";
import { parseRedirectForm } from "$lib/server/redirect-form";
import { RedirectService } from "$lib/services/redirect.service";

const logger = new Logger("Redirects");

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const result = await parseRedirectForm(await request.formData());
		if ("error" in result) {
			return fail(400, { error: result.error });
		}

		const created = await RedirectDTO.create({
			...result.fields,
			userId: locals.user.id,
		});
		await RedirectService.sync();
		logger.info(
			`Redirect created: redirect=${created.toJSON().id} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
