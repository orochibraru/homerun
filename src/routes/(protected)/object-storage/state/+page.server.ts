import { fail, redirect } from "@sveltejs/kit";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { IacStateVersionDTO } from "#lib/dto/iac-state-version-dto.js";
import { IacStateService } from "#lib/services/iac-state.service.js";
import { resolve } from "$app/paths";

export const load = async () => {
	const projects = await IacProjectDTO.list();
	return {
		projects: await Promise.all(
			projects.map(async (project) => {
				const [latest, lock] = await Promise.all([
					IacStateVersionDTO.latest(project.id),
					project.currentLock(),
				]);
				return {
					bucket: project.bucket,
					id: project.id,
					locked: lock !== null,
					name: project.name,
					serial: latest?.serial ?? null,
					updatedAt: latest?.toJSON().createdAt ?? null,
				};
			}),
		),
	};
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
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
