import { and, desc, eq, inArray, max, notInArray, sql, sum } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type ErrorSourceMap, errorSourceMap } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface SourceMapRelease {
	files: number;
	release: string;
	sizeBytes: number;
	uploadedAt: Date;
}

export const SOURCE_MAP_RELEASES_KEPT = 10;

/**
 * Wraps `error_source_map`: the source maps uploaded for a service's
 * release, one row per minified file they describe, used to map browser
 * stack frames back to their source when an error arrives. Only the most
 * recent `SOURCE_MAP_RELEASES_KEPT` releases of a service are kept.
 */
export class ErrorSourceMapDTO extends BaseDTO<ErrorSourceMap> {
	/** The id and file name of every map of one release, without their content. */
	static async namesFor(
		serviceId: string,
		release: string,
	): Promise<{ id: string; name: string }[]> {
		return await db
			.select({ id: errorSourceMap.id, name: errorSourceMap.name })
			.from(errorSourceMap)
			.where(
				and(
					eq(errorSourceMap.serviceId, serviceId),
					eq(errorSourceMap.release, release),
				),
			);
	}

	/** One map's JSON, null when it's gone. */
	static async content(id: string): Promise<string | null> {
		const [row] = await db
			.select({ content: errorSourceMap.content })
			.from(errorSourceMap)
			.where(eq(errorSourceMap.id, id))
			.limit(1);
		return row?.content ?? null;
	}

	/** A service's releases with maps, newest upload first, with their file count and total size. */
	static async releases(serviceId: string): Promise<SourceMapRelease[]> {
		const rows = await db
			.select({
				files: sql<number>`count(*)::int`,
				release: errorSourceMap.release,
				sizeBytes: sum(errorSourceMap.sizeBytes).mapWith(Number),
				uploadedAt: max(errorSourceMap.createdAt),
			})
			.from(errorSourceMap)
			.where(eq(errorSourceMap.serviceId, serviceId))
			.groupBy(errorSourceMap.release)
			.orderBy(desc(max(errorSourceMap.createdAt)));
		return rows.map((row) => ({
			files: row.files,
			release: row.release,
			sizeBytes: row.sizeBytes ?? 0,
			uploadedAt: row.uploadedAt ?? new Date(0),
		}));
	}

	/**
	 * Stores a release's maps, replacing any with the same file name, then
	 * drops the service's releases beyond the most recent
	 * `SOURCE_MAP_RELEASES_KEPT`.
	 */
	static async store(
		serviceId: string,
		release: string,
		files: { content: string; name: string }[],
	): Promise<void> {
		const createdAt = new Date();
		await db.transaction(async (tx) => {
			await tx.delete(errorSourceMap).where(
				and(
					eq(errorSourceMap.serviceId, serviceId),
					eq(errorSourceMap.release, release),
					inArray(
						errorSourceMap.name,
						files.map((file) => file.name),
					),
				),
			);
			await tx.insert(errorSourceMap).values(
				files.map((file) => ({
					content: file.content,
					createdAt,
					id: crypto.randomUUID(),
					name: file.name,
					release,
					serviceId,
					sizeBytes: Buffer.byteLength(file.content),
				})),
			);
		});
		const kept = (await ErrorSourceMapDTO.releases(serviceId))
			.slice(0, SOURCE_MAP_RELEASES_KEPT)
			.map((entry) => entry.release);
		await db
			.delete(errorSourceMap)
			.where(
				and(
					eq(errorSourceMap.serviceId, serviceId),
					notInArray(errorSourceMap.release, kept),
				),
			);
	}

	/**
	 * Deletes a release's maps.
	 *
	 * @returns How many files were deleted.
	 */
	static async deleteRelease(
		serviceId: string,
		release: string,
	): Promise<number> {
		const deleted = await db
			.delete(errorSourceMap)
			.where(
				and(
					eq(errorSourceMap.serviceId, serviceId),
					eq(errorSourceMap.release, release),
				),
			)
			.returning({ id: errorSourceMap.id });
		return deleted.length;
	}
}
