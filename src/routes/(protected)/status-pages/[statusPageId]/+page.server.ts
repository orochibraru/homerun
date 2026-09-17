import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { BEAT_WINDOW, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { dashboardOrigin } from "$lib/server/canonical-origin";
import { statusPageSchema } from "$lib/server/validation/status-page";

export const load = async ({ params, parent, request, url }) => {
	const { user } = await parent();

	const page = await StatusPageDTO.get(params.statusPageId, user.id);
	if (!page) {
		error(404, "Status page not found");
	}

	const [stacks, allServices, memberIds] = await Promise.all([
		StackDTO.list(user.id),
		ServiceDTO.list(user.id),
		page.serviceIds(),
	]);

	const members = allServices.filter((svc) => memberIds.includes(svc.id));
	const beats = await Promise.all(
		members.map(async (svc) => ({
			beats: (await UptimeCheckDTO.beats(svc.id, "internal")).map((beat) => ({
				checkedAt: beat.checkedAt,
				detail: beat.detail,
				ok: beat.ok,
			})),
			id: svc.id,
			name: svc.name,
			slug: svc.slug,
		})),
	);

	return {
		dashboardOrigin: dashboardOrigin(request, url),
		beatWindow: BEAT_WINDOW,
		memberIds,
		stacks: stacks.map((p) => ({ id: p.id, name: p.name })),
		services: allServices.map((svc) => ({
			id: svc.id,
			name: svc.name,
			stackId: svc.stackId,
		})),
		statusPage: page.toJSON(),
		tracked: beats,
	};
};

export const actions = {
	update: async ({ locals, params, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const page = await StatusPageDTO.get(params.statusPageId, locals.user.id);
		if (!page) {
			return fail(404, { error: "Status page not found." });
		}

		const form = await request.formData();
		const parsed = statusPageSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
			});
		}
		const fieldErrors: Record<string, string[]> = {};
		if (await StatusPageDTO.slugTaken(parsed.data.slug, page.id)) {
			fieldErrors.slug = ["That slug is already taken."];
		}
		if (parsed.data.scope === "stack" && !parsed.data.stackId) {
			fieldErrors.stackId = ["Pick the stack this page covers."];
		}
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, { errors: fieldErrors });
		}

		await page.update({
			description: parsed.data.description || null,
			isPublic: parsed.data.isPublic,
			name: parsed.data.name,
			stackId: parsed.data.scope === "stack" ? parsed.data.stackId : null,
			scope: parsed.data.scope,
			slug: parsed.data.slug,
		});
		if (parsed.data.scope === "custom") {
			await page.setServiceIds(form.getAll("serviceIds").map(String));
		}
		return { success: true };
	},

	delete: async ({ locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const page = await StatusPageDTO.get(params.statusPageId, locals.user.id);
		if (!page) {
			return fail(404, { error: "Status page not found." });
		}
		await page.delete();
		throw redirect(303, resolve("/status-pages"));
	},
};
