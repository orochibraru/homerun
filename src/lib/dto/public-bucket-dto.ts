import { and, eq } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import { type PublicBucket, publicBucket } from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

/**
 * Wraps the `public_bucket` table: the buckets whose objects Homerun serves
 * to anyone at `/public/<storeId>/<bucket>/<key>`. A bucket without a row is
 * private, which is every bucket by default.
 */
export class PublicBucketDTO extends BaseDTO<PublicBucket> {
	/** Whether `bucket` on `storeId` is public. */
	static async isPublic(storeId: string, bucket: string): Promise<boolean> {
		const [row] = await db
			.select({ bucket: publicBucket.bucket })
			.from(publicBucket)
			.where(
				and(eq(publicBucket.storeId, storeId), eq(publicBucket.bucket, bucket)),
			)
			.limit(1);
		return row !== undefined;
	}

	/** The names of the public buckets on `storeId`. */
	static async namesForStore(storeId: string): Promise<Set<string>> {
		const rows = await db
			.select({ bucket: publicBucket.bucket })
			.from(publicBucket)
			.where(eq(publicBucket.storeId, storeId));
		return new Set(rows.map((row) => row.bucket));
	}

	/** Makes `bucket` on `storeId` public or private again. */
	static async setPublic(
		storeId: string,
		bucket: string,
		isPublic: boolean,
	): Promise<void> {
		if (isPublic) {
			await db
				.insert(publicBucket)
				.values({ bucket, createdAt: new Date(), storeId })
				.onConflictDoNothing();
			return;
		}
		await db
			.delete(publicBucket)
			.where(
				and(eq(publicBucket.storeId, storeId), eq(publicBucket.bucket, bucket)),
			);
	}
}
