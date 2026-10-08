import { fail, redirect } from "@sveltejs/kit";
import { IacStateService } from "#lib/services/iac-state.service.js";
import { resolve } from "$app/paths";

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		try {
			const project = await IacStateService.createProject({
				bucket: String(formData.get("bucket") ?? "").trim(),
				name: String(formData.get("name") ?? ""),
				prefix: String(formData.get("prefix") ?? ""),
				storeId: String(formData.get("storeId") ?? ""),
				userId: locals.user.id,
			});
			return { projectId: project.id, success: true };
		} catch (cause) {
			return fail(400, {
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	},
};
