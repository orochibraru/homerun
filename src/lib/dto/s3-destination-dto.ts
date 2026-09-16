import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type S3Destination, s3Destination } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { decryptSecret, encryptSecret } from "$lib/services/secrets";
import { BaseDTO } from "./base-dto";

export interface NewS3DestinationInput {
	accessKeyId: string;
	bucket: string;
	endpoint: string;
	name: string;
	region: string;
	secretAccessKey: string;
	userId: string;
}

export type S3DestinationUpdateInput = Partial<
	Pick<S3Destination, "accessKeyId" | "bucket" | "endpoint" | "name" | "region">
> & {
	/** Blank/undefined means "keep the currently stored secret". */
	secretAccessKey?: string;
};

/** Wraps the `s3_destination` table : see ServiceDTO for the pattern this follows. */
export class S3DestinationDTO extends BaseDTO<S3Destination> {
	/**
	 * Loads one S3 destination by id, scoped to its owner; null when missing or
	 * owned by someone else.
	 */
	static async get(
		id: string,
		userId: string,
	): Promise<S3DestinationDTO | null> {
		const [row] = await db
			.select()
			.from(s3Destination)
			.where(and(eq(s3Destination.id, id), eq(s3Destination.userId, userId)))
			.limit(1);
		return row ? new S3DestinationDTO(row) : null;
	}

	/** Every S3 destination the user owns, newest first. */
	static async list(userId: string): Promise<S3DestinationDTO[]> {
		const rows = await db
			.select()
			.from(s3Destination)
			.where(eq(s3Destination.userId, userId))
			.orderBy(desc(s3Destination.createdAt));
		return rows.map((row) => new S3DestinationDTO(row));
	}

	/** One page of `list`, searched server-side, plus the unpaged total. */
	static async listPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<S3DestinationDTO>> {
		const conditions: SQL[] = [eq(s3Destination.userId, userId)];
		const search = searchCondition(query.q, [
			s3Destination.name,
			s3Destination.endpoint,
			s3Destination.bucket,
			s3Destination.region,
		]);
		if (search) {
			conditions.push(search);
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(s3Destination)
				.where(where)
				.orderBy(desc(s3Destination.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(s3Destination).where(where),
		]);

		return {
			items: rows.map((row) => new S3DestinationDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/**
	 * Up to `limit` of the user's destinations whose name, endpoint, bucket or
	 * region matches `q`, newest first, for global search.
	 */
	static async search(
		userId: string,
		q: string,
		limit: number,
	): Promise<S3DestinationDTO[]> {
		const rows = await db
			.select()
			.from(s3Destination)
			.where(
				and(
					eq(s3Destination.userId, userId),
					searchCondition(q, [
						s3Destination.name,
						s3Destination.endpoint,
						s3Destination.bucket,
						s3Destination.region,
					]),
				),
			)
			.orderBy(desc(s3Destination.createdAt))
			.limit(limit);
		return rows.map((row) => new S3DestinationDTO(row));
	}

	/**
	 * Inserts a new destination, encrypting its secret access key before it is
	 * stored.
	 */
	static async create(input: NewS3DestinationInput): Promise<S3DestinationDTO> {
		const now = new Date();
		const row: S3Destination = {
			accessKeyId: input.accessKeyId,
			bucket: input.bucket,
			createdAt: now,
			endpoint: input.endpoint,
			id: crypto.randomUUID(),
			name: input.name,
			region: input.region,
			secretAccessKeyEnc: encryptSecret(input.secretAccessKey),
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(s3Destination).values(row);
		return new S3DestinationDTO(row);
	}

	/**
	 * Saves edited destination fields; a blank secret access key keeps the stored
	 * one, anything else is re-encrypted.
	 */
	async update(input: S3DestinationUpdateInput): Promise<void> {
		const { secretAccessKey, ...rest } = input;
		const patch = {
			...rest,
			...(secretAccessKey
				? { secretAccessKeyEnc: encryptSecret(secretAccessKey) }
				: {}),
		};
		await db
			.update(s3Destination)
			.set(patch)
			.where(eq(s3Destination.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes this destination row. */
	async delete(): Promise<void> {
		await db.delete(s3Destination).where(eq(s3Destination.id, this.row.id));
	}

	/** The destination's id. */
	get id(): string {
		return this.row.id;
	}
	/** The destination's display name. */
	get name(): string {
		return this.row.name;
	}
	/** The S3-compatible endpoint URL. */
	get endpoint(): string {
		return this.row.endpoint;
	}
	/** The bucket backups are uploaded to. */
	get bucket(): string {
		return this.row.bucket;
	}
	/** The bucket's region. */
	get region(): string {
		return this.row.region;
	}
	/** The access key id used to authenticate (not secret). */
	get accessKeyId(): string {
		return this.row.accessKeyId;
	}

	/** Decrypted secret access key, for the S3 client only : never exposed to a `load` return value. */
	decryptSecretAccessKey(): string {
		return decryptSecret(this.row.secretAccessKeyEnc) ?? "";
	}
}
