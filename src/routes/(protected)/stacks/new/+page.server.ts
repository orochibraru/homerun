import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { stackPath } from "$lib/stack-tree";

const logger = new Logger("Stacks");
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export const load = async ({ parent, url }) => {
	await parent();
	const parentId = url.searchParams.get("parentId");
	const stack = parentId ? await StackDTO.get(parentId) : null;
	if (!stack) {
		return { parent: null };
	}
	const all = (await StackDTO.list()).map((s) => ({
		id: s.id,
		name: s.name,
		parentId: s.parentId,
		slug: s.slug,
	}));
	return {
		parent: { id: stack.id, path: stackPath(stack.id, all), slug: stack.slug },
	};
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const slug = (formData.get("slug") as string | null)?.trim() ?? "";
		const description =
			(formData.get("description") as string | null)?.trim() || null;
		const parentId = (formData.get("parentId") as string | null) || null;
		const parentStack = parentId ? await StackDTO.get(parentId) : null;
		if (parentId && !parentStack) {
			return fail(400, { error: "That parent stack no longer exists." });
		}

		if (!name) {
			return fail(400, { error: "Name is required." });
		}
		if (!SLUG_RE.test(slug)) {
			return fail(400, {
				error: "Slug must be lowercase letters, numbers, and hyphens only.",
			});
		}
		if (await StackDTO.slugTaken(slug)) {
			return fail(400, { error: "That slug is already in use." });
		}

		const stack = await StackDTO.create({
			description,
			name,
			parentId: parentStack?.id ?? null,
			slug,
			userId: locals.user.id,
		});

		logger.info(
			`Stack created: stack=${stack.id} parent=${parentStack?.id ?? "none"} user=${locals.user.id}`,
		);
		redirect(
			303,
			parentStack
				? resolve("/(protected)/stacks/[stackId]", { stackId: parentStack.id })
				: resolve("/stacks"),
		);
	},
};
