import { fail, redirect } from "@sveltejs/kit";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { parseObjectStoreForm } from "#lib/server/validation/object-store.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { resolve } from "$app/paths";

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const { error, values } = parseObjectStoreForm(
			await request.formData(),
			true,
		);
		if (error) {
			return fail(400, { error });
		}
		try {
			await ObjectStorageService.testCredentials(values);
		} catch (cause) {
			return fail(400, {
				error: `Couldn't list buckets with these settings: ${cause instanceof Error ? cause.message : String(cause)}`,
			});
		}
		const store = await ObjectStoreDTO.create({
			...values,
			kind: "s3",
			userId: locals.user.id,
		});
		return { storeId: store.id, success: true };
	},
};
