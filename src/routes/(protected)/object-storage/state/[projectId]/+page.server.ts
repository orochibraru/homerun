import { error, fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { IacStateVersionDTO } from "#lib/dto/iac-state-version-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { httpBackendBlock, pulumiLoginCommand } from "#lib/iac-state.js";
import { highlightCode } from "#lib/server/shiki.js";
import { IacStateService } from "#lib/services/iac-state.service.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { resolve } from "$app/paths";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async ({ params, url }) => {
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		error(404, "That state project doesn't exist.");
	}
	const store = await ObjectStoreDTO.get(project.storeId);
	const [history, lock, endpoint] = await Promise.all([
		IacStateVersionDTO.history(project.id),
		project.lockView(),
		store ? ObjectStorageService.publicEndpoint(store) : Promise.resolve(""),
	]);
	const apiBase = `${config.auth.origin ?? url.origin}/api/v1/iac/projects/${project.id}`;
	const terraform = httpBackendBlock(apiBase);
	const pulumi = store
		? pulumiLoginCommand({
				bucket: project.bucket,
				endpoint,
				prefix: project.prefix,
				region: store.region,
				slug: project.slug,
			})
		: null;
	return {
		apiBase,
		snippets: {
			pulumi: pulumi
				? { code: pulumi, html: await highlightCode(pulumi, "shellscript") }
				: null,
			terraform: {
				code: terraform,
				html: await highlightCode(terraform, "hcl"),
			},
		},
		history,
		lock,
		project: {
			bucket: project.bucket,
			id: project.id,
			name: project.name,
			prefix: project.prefix,
			slug: project.slug,
		},
		store: store ? { endpoint, name: store.name, region: store.region } : null,
	};
};

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const project = await IacProjectDTO.get(params.projectId);
		if (!project) {
			return fail(404, { error: "That state project doesn't exist." });
		}
		await project.delete();
		return { success: true };
	},

	forceUnlock: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const project = await IacProjectDTO.get(params.projectId);
		if (!project) {
			return fail(404, { error: "That state project doesn't exist." });
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
			return fail(404, { error: "That state project doesn't exist." });
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
