import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { IacStateVersionDTO } from "#lib/dto/iac-state-version-dto.js";
import { httpBackendBlock } from "#lib/iac-state.js";
import { highlightCode } from "#lib/server/shiki.js";
import { IacStateService } from "#lib/services/iac-state.service.js";
import { resolve } from "$app/paths";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async ({ params, parent, url }) => {
	const { project } = await parent();
	const row = await IacProjectDTO.get(project.id);
	const [history, lock] = await Promise.all([
		IacStateVersionDTO.history(project.id),
		row ? row.lockView() : Promise.resolve(null),
	]);
	const terraform = httpBackendBlock(
		`${config.auth.origin ?? url.origin}/api/v1/iac/projects/${params.projectId}`,
	);
	return {
		history,
		lock,
		terraform: { code: terraform, html: await highlightCode(terraform, "hcl") },
	};
};

export const actions = {
	forceUnlock: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const project = await IacProjectDTO.get(params.projectId);
		if (!project) {
			return fail(404, { error: "That state backend doesn't exist." });
		}
		await IacStateService.unlock(project, null, true);
		return { success: true };
	},

	rollback: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const project = await IacProjectDTO.get(params.projectId);
		if (!project) {
			return fail(404, { error: "That state backend doesn't exist." });
		}
		const versionId = String((await request.formData()).get("versionId") ?? "");
		try {
			const version = await IacStateService.rollback(
				project,
				versionId,
				locals.user.id,
			);
			return { serial: version.serial, success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},
};
