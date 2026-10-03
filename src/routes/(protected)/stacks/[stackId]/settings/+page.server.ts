import { fail, redirect } from "@sveltejs/kit";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { Logger } from "#lib/logger.js";
import { listIconLibrary } from "#lib/server/icon-library.js";
import { iconProblem } from "#lib/service-icon.js";
import { WorkloadDetachError } from "#lib/services/docker/workload-removal.js";
import { ServiceLifecycleService } from "#lib/services/service-lifecycle.service.js";
import { descendantIds, stackPath } from "#lib/stack-tree.js";
import { resolve } from "$app/paths";

const logger = new Logger("Stacks");
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export const load = async ({ params, parent }) => {
	await parent();
	const [all, icons] = await Promise.all([StackDTO.list(), listIconLibrary()]);
	const stacks = all.map((s) => ({
		id: s.id,
		name: s.name,
		parentId: s.parentId,
		slug: s.slug,
	}));
	const excluded = new Set([
		params.stackId,
		...descendantIds(params.stackId, stacks),
	]);
	return {
		icons,
		parentOptions: stacks
			.filter((s) => !excluded.has(s.id))
			.map((s) => ({ id: s.id, path: stackPath(s.id, stacks) }))
			.sort((a, b) => a.path.localeCompare(b.path)),
	};
};

export const actions = {
	updateIcon: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const stack = await StackDTO.get(params.stackId);
		if (!stack) {
			return fail(404, { error: "Stack not found." });
		}
		const icon = String((await request.formData()).get("icon") ?? "");
		const bundled = (await listIconLibrary()).map((i) => i.icon);
		const problem = icon === stack.icon ? null : iconProblem(icon, bundled);
		if (problem) {
			return fail(400, { error: problem });
		}
		await stack.update({ icon: icon || null });
		logger.info(
			`Stack icon updated: stack=${stack.id} icon=${icon.startsWith("data:") ? "upload" : icon || "none"} user=${locals.user.id}`,
		);
		return { success: true };
	},
	move: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const stack = await StackDTO.get(params.stackId);
		if (!stack) {
			return fail(404, { error: "Stack not found." });
		}

		const parentId =
			((await request.formData()).get("parentId") as string | null) || null;

		try {
			await stack.setParent(parentId);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		logger.info(
			`Stack moved: stack=${stack.id} parent=${parentId ?? "none"} user=${locals.user.id}`,
		);
		return { success: true };
	},
	delete: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const stack = await StackDTO.get(params.stackId);
		if (!stack) {
			return fail(404, { error: "Stack not found." });
		}
		const force = (await request.formData()).get("force") === "true";
		try {
			await ServiceLifecycleService.deleteStack(stack, { force });
		} catch (error) {
			if (error instanceof WorkloadDetachError) {
				return fail(409, { detachFailed: true, error: error.message });
			}
			throw error;
		}

		logger.info(
			`Stack deleted: stack=${params.stackId} force=${force} user=${locals.user.id}`,
		);
		redirect(303, resolve("stacks"));
	},
	rename: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const stack = await StackDTO.get(params.stackId);
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
