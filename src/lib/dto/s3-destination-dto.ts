import { and, desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type S3Destination, s3Destination } from "$lib/server/db/schema";
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

	static async list(userId: string): Promise<S3DestinationDTO[]> {
		const rows = await db
			.select()
			.from(s3Destination)
			.where(eq(s3Destination.userId, userId))
			.orderBy(desc(s3Destination.createdAt));
		return rows.map((row) => new S3DestinationDTO(row));
	}

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

	async delete(): Promise<void> {
		await db.delete(s3Destination).where(eq(s3Destination.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get name(): string {
		return this.row.name;
	}
	get endpoint(): string {
		return this.row.endpoint;
	}
	get bucket(): string {
		return this.row.bucket;
	}
	get region(): string {
		return this.row.region;
	}
	get accessKeyId(): string {
		return this.row.accessKeyId;
	}

	/** Decrypted secret access key, for the S3 client only : never exposed to a `load` return value. */
	decryptSecretAccessKey(): string {
		return decryptSecret(this.row.secretAccessKeyEnc) ?? "";
	}
}
