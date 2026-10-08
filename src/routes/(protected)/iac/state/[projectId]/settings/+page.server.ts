import { fail, redirect } from "@sveltejs/kit";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { resolve } from "$app/paths";

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const project = await IacProjectDTO.get(params.projectId);
		if (!project) {
			return fail(404, { error: "That state backend doesn't exist." });
		}
		await project.delete();
		return { success: true };
	},
};
