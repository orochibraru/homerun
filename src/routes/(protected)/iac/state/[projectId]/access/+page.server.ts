import { fail, redirect } from "@sveltejs/kit";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { pulumiLoginCommand } from "#lib/iac-state.js";
import {
	createBucketKeyAction,
	revokeBucketKeyAction,
} from "#lib/server/bucket-key-actions.js";
import { highlightCode } from "#lib/server/shiki.js";
import { resolve } from "$app/paths";

async function projectStore(projectId: string) {
	const project = await IacProjectDTO.get(projectId);
	const store = project ? await ObjectStoreDTO.get(project.storeId) : null;
	return project && store ? { bucket: project.bucket, store } : null;
}

export const load = async ({ parent }) => {
	const { project, store } = await parent();
	if (!store) {
		return { pulumi: null };
	}
	const pulumi = pulumiLoginCommand({
		bucket: project.bucket,
		endpoint: store.endpoint,
		prefix: project.prefix,
		region: store.region,
		slug: project.slug,
	});
	return {
		pulumi: { code: pulumi, html: await highlightCode(pulumi, "shellscript") },
	};
};

export const actions = {
	createKey: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const found = await projectStore(params.projectId);
		if (!found) {
			return fail(404, {
				error: "The backend's object store no longer exists.",
			});
		}
		return await createBucketKeyAction(
			found.store,
			found.bucket,
			await request.formData(),
		);
	},

	revokeKey: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const found = await projectStore(params.projectId);
		if (!found) {
			return fail(404, {
				error: "The backend's object store no longer exists.",
			});
		}
		return await revokeBucketKeyAction(found.store, await request.formData());
	},
};
