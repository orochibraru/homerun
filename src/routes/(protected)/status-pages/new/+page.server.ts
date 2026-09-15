import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { statusPageSchema } from "$lib/server/validation/status-page";

export const load = async ({ parent }) => {
	const { user } = await parent();
	const [projects, services] = await Promise.all([
		ProjectDTO.list(user.id),
		ServiceDTO.list(user.id),
	]);
	return {
		projects: projects.map((p) => ({ id: p.id, name: p.name })),
		services: services.map((svc) => ({
			id: svc.id,
			name: svc.name,
			projectId: svc.projectId,
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
		if (parsed.data.scope === "project" && !parsed.data.projectId) {
			fieldErrors.projectId = ["Pick the project this page covers."];
		}
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, { errors: fieldErrors });
		}

		const page = await StatusPageDTO.create({
			description: parsed.data.description || null,
			isPublic: parsed.data.isPublic,
			name: parsed.data.name,
			projectId: parsed.data.scope === "project" ? parsed.data.projectId : null,
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
