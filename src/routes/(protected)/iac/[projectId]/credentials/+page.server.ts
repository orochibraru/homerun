import { fail, redirect } from "@sveltejs/kit";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { listOwnApiKeys, revokeApiKeyAction } from "#lib/server/api-keys.js";
import {
	createBucketKeyAction,
	revokeBucketKeyAction,
} from "#lib/server/bucket-key-actions.js";
import { resolve } from "$app/paths";

async function projectStore(projectId: string) {
	const project = await IacProjectDTO.get(projectId);
	const store = project ? await ObjectStoreDTO.get(project.storeId) : null;
	return project && store ? { bucket: project.bucket, store } : null;
}

export const load = async ({ request }) => ({
	apiKeys: await listOwnApiKeys(request.headers),
});

export const actions = {
	createKey: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const found = await projectStore(params.projectId);
		if (!found) {
			return fail(404, {
				error: "The project's object store no longer exists.",
			});
		}
		return await createBucketKeyAction(
			found.store,
			found.bucket,
			await request.formData(),
		);
	},

	revoke: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		return await revokeApiKeyAction(request, locals.user.id);
	},

	revokeKey: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const found = await projectStore(params.projectId);
		if (!found) {
			return fail(404, {
				error: "The project's object store no longer exists.",
			});
		}
		return await revokeBucketKeyAction(found.store, await request.formData());
	},
};
