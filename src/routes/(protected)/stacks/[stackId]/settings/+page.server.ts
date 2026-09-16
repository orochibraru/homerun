import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Stacks");
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const stack = await StackDTO.get(params.stackId, locals.user.id);
		if (!stack) {
			return fail(404, { error: "Stack not found." });
		}
		await stack.cascadeDelete();
		logger.info(
			`Stack deleted: stack=${params.stackId} user=${locals.user.id}`,
		);
		redirect(303, resolve("/stacks"));
	},
	rename: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const stack = await StackDTO.get(params.stackId, locals.user.id);
		if (!stack) {
			return fail(404, { error: "Stack not found." });
		}
		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const slug = (formData.get("slug") as string | null)?.trim() ?? "";
		const description =
			(formData.get("description") as string | null)?.trim() || null;

		if (!name) {
			return fail(400, { error: "Name is required." });
		}
		if (!SLUG_RE.test(slug)) {
			return fail(400, {
				error: "Slug must be lowercase letters, numbers, and hyphens only.",
			});
		}
		if (await StackDTO.slugTaken(slug, stack.id)) {
			return fail(400, { error: "That slug is already in use." });
		}

		await stack.update({ description, name, slug });

		logger.info(
			`Stack renamed: stack=${params.stackId} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
