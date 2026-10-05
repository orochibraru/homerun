import { error, fail, redirect } from "@sveltejs/kit";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { StatusPageDTO } from "#lib/dto/status-page-dto.js";
import { BEAT_WINDOW, UptimeCheckDTO } from "#lib/dto/uptime-check-dto.js";
import { dashboardOrigin } from "#lib/server/canonical-origin.js";
import { statusPageSchema } from "#lib/server/validation/status-page.js";
import {
	picksFromForm,
	statusPageServiceOptions,
} from "#lib/status-page-members.js";
import { resolve } from "$app/paths";

export const load = async ({ params, parent, request, url }) => {
	await parent();

	const page = await StatusPageDTO.get(params.statusPageId);
	if (!page) {
		error(404, "Status page not found");
	}

	const picks = await page.picks();
	const [stacks, allServices, shown] = await Promise.all([
		StackDTO.list(),
		ServiceDTO.list(),
		page.members(picks),
	]);
	const beats = await Promise.all(
		shown.map(async (member) => ({
			beats: (await UptimeCheckDTO.beats(member.id, "internal")).map(
				(beat) => ({
					checkedAt: beat.checkedAt,
					detail: beat.detail,
					ok: beat.ok,
				}),
			),
			childOf: member.childOf,
			id: member.id,
			name: member.name,
		})),
	);

	return {
		dashboardOrigin: dashboardOrigin(request, url),
		beatWindow: BEAT_WINDOW,
		picks,
		stacks: stacks.map((p) => ({ id: p.id, name: p.name })),
		services: statusPageServiceOptions(allServices.map((svc) => svc.toJSON())),
		statusPage: page.toJSON(),
		tracked: beats,
	};
};

export const actions = {
	update: async ({ locals, params, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const page = await StatusPageDTO.get(params.statusPageId);
		if (!page) {
			return fail(404, { error: "Status page not found." });
		}

		const form = await request.formData();
		const parsed = statusPageSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) {
			return fail(400, {
				errors: parsed.error.flatten().fieldErrors,
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
			await page.setPicks(picksFromForm(form));
		}
		return { success: true };
	},

	delete: async ({ locals, params }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const page = await StatusPageDTO.get(params.statusPageId);
		if (!page) {
			return fail(404, { error: "Status page not found." });
		}
		await page.delete();
		throw redirect(303, resolve("status-pages"));
	},
};
