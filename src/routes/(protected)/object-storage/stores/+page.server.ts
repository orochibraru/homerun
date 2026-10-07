import { fail, redirect } from "@sveltejs/kit";
import { parseObjectStoreForm } from "#lib/server/validation/object-store.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { resolve } from "$app/paths";

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const { error, values } = parseObjectStoreForm(
			await request.formData(),
			true,
		);
		if (error) {
			return fail(400, { error });
		}
		try {
			const store = await ObjectStorageService.createStore(
				values,
				locals.user.id,
			);
			return { storeId: store.id, success: true };
		} catch (cause) {
			return fail(400, {
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	},
};
