import { error, fail, redirect } from "@sveltejs/kit";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { MAX_EXPIRATION_DAYS } from "#lib/object-storage.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { resolve } from "$app/paths";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async ({ params }) => {
	const store = await ObjectStoreDTO.get(params.storeId);
	if (!store) {
		error(404, "That object store doesn't exist.");
	}
	const detail = await ObjectStorageService.bucket(store, params.bucket).catch(
		(cause: unknown) =>
			error(503, `The bucket can't be read: ${reason(cause)}`),
	);
	return {
		bucket: params.bucket,
		detail,
		store: store.summary(),
		usage: ObjectStorageService.usage(store, params.bucket).catch(() => null),
	};
};

export const actions = {
	createKey: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const store = await ObjectStoreDTO.get(params.storeId);
		if (!store) {
			return fail(404, { error: "That object store doesn't exist." });
		}
		const formData = await request.formData();
		const name = String(formData.get("name") ?? "").trim();
		if (!name) {
			return fail(400, { error: "Name the key after what uses it." });
		}
		const permissions = {
			owner: formData.get("owner") === "on",
			read: formData.get("read") === "on",
			write: formData.get("write") === "on",
		};
		if (!(permissions.read || permissions.write || permissions.owner)) {
			return fail(400, { error: "Give the key at least one permission." });
		}
		try {
			const key = await ObjectStorageService.createKey(
				store,
				params.bucket,
				name,
				permissions,
			);
			return { createdKey: { ...key, name }, success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},

	deleteBucket: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const store = await ObjectStoreDTO.get(params.storeId);
		if (!store) {
			return fail(404, { error: "That object store doesn't exist." });
		}
		try {
			await ObjectStorageService.deleteBucket(store, params.bucket);
			return { success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},

	revokeKey: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const store = await ObjectStoreDTO.get(params.storeId);
		if (!store) {
			return fail(404, { error: "That object store doesn't exist." });
		}
		const accessKeyId = String(
			(await request.formData()).get("accessKeyId") ?? "",
		);
		try {
			await ObjectStorageService.revokeKey(store, accessKeyId);
			return { success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},

	setExpiration: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const store = await ObjectStoreDTO.get(params.storeId);
		if (!store) {
			return fail(404, { error: "That object store doesn't exist." });
		}
		const raw = String((await request.formData()).get("days") ?? "").trim();
		const days = raw ? Number(raw) : null;
		if (
			days !== null &&
			!(Number.isInteger(days) && days >= 1 && days <= MAX_EXPIRATION_DAYS)
		) {
			return fail(400, {
				error: `Days is a whole number from 1 to ${MAX_EXPIRATION_DAYS}, or empty to keep objects forever.`,
			});
		}
		try {
			await ObjectStorageService.setExpiration(store, params.bucket, days);
			return { success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},

	useAsBackupDestination: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const store = await ObjectStoreDTO.get(params.storeId);
		if (!store) {
			return fail(404, { error: "That object store doesn't exist." });
		}
		try {
			const destination = await ObjectStorageService.useAsBackupDestination(
				store,
				params.bucket,
				locals.user.id,
			);
			return { destinationId: destination.id, success: true };
		} catch (cause) {
			return fail(400, { error: reason(cause) });
		}
	},
};
