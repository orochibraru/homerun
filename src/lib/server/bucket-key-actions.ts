import { fail } from "@sveltejs/kit";
import type { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The `createKey` form action shared by every page that shows a bucket's
 * access keys: validates the name and permissions, then creates the key.
 *
 * @returns The new key with its secret, or a 400 failure with the reason.
 */
export async function createBucketKeyAction(
	store: ObjectStoreDTO,
	bucket: string,
	formData: FormData,
) {
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
			bucket,
			name,
			permissions,
		);
		return { createdKey: { ...key, name }, success: true };
	} catch (cause) {
		return fail(400, { error: reason(cause) });
	}
}

/**
 * The `revokeKey` form action shared by every page that shows a bucket's
 * access keys.
 *
 * @returns Success, or a 400 failure with the store's reason.
 */
export async function revokeBucketKeyAction(
	store: ObjectStoreDTO,
	formData: FormData,
) {
	try {
		await ObjectStorageService.revokeKey(
			store,
			String(formData.get("accessKeyId") ?? ""),
		);
		return { success: true };
	} catch (cause) {
		return fail(400, { error: reason(cause) });
	}
}
