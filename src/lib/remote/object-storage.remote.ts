import { z } from "zod";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { requireAdmin } from "#lib/server/remote-auth.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { query } from "$app/server";

export interface BucketUsageRow {
	bucket: string;
	bytes: number | null;
	capped: boolean;
	error: string | null;
	objects: number | null;
	storeId: string;
}

export const getBucketUsages = query(
	z.array(z.object({ bucket: z.string(), storeId: z.string() })).max(200),
	async (buckets): Promise<BucketUsageRow[]> => {
		requireAdmin();
		const stores = new Map(
			(await ObjectStoreDTO.list()).map((store) => [store.id, store]),
		);
		return await Promise.all(
			buckets.map(async ({ bucket, storeId }) => {
				const store = stores.get(storeId);
				try {
					if (!store) {
						throw new Error("That store no longer exists.");
					}
					const usage = await ObjectStorageService.usage(store, bucket);
					return { bucket, error: null, storeId, ...usage };
				} catch (err) {
					return {
						bucket,
						bytes: null,
						capped: false,
						error: err instanceof Error ? err.message : String(err),
						objects: null,
						storeId,
					};
				}
			}),
		);
	},
);
