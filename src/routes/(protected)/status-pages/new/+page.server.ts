import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { statusPageSchema } from "$lib/server/validation/status-page";

export const load = async ({ parent }) => {
	await parent();
	const [stacks, services] = await Promise.all([
		StackDTO.list(),
		ServiceDTO.list(),
	]);
	return {
		stacks: stacks.map((p) => ({ id: p.id, name: p.name })),
		services: services.map((svc) => ({
			id: svc.id,
			name: svc.name,
			stackId: svc.stackId,
		})),
	};
};

export const actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const form = await request.formData();
		const parsed = statusPageSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
			});
		}
		const fieldErrors: Record<string, string[]> = {};
		if (await StatusPageDTO.slugTaken(parsed.data.slug)) {
			fieldErrors.slug = ["That slug is already taken."];
		}
		if (parsed.data.scope === "stack" && !parsed.data.stackId) {
			fieldErrors.stackId = ["Pick the stack this page covers."];
		}
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, { errors: fieldErrors });
		}

		const page = await StatusPageDTO.create({
			description: parsed.data.description || null,
			isPublic: parsed.data.isPublic,
			name: parsed.data.name,
			stackId: parsed.data.scope === "stack" ? parsed.data.stackId : null,
			scope: parsed.data.scope,
			slug: parsed.data.slug,
			userId: locals.user.id,
		});

		if (parsed.data.scope === "custom") {
			await page.setServiceIds(form.getAll("serviceIds").map(String));
		}

		throw redirect(303, `${resolve("/status-pages")}/${page.id}`);
	},
};
