import { asc, eq } from "drizzle-orm";
import type { ObjectStoreKind } from "#lib/object-storage.js";
import { db } from "#lib/server/db/lib.js";
import { type ObjectStore, objectStore } from "#lib/server/db/schema.js";
import { decryptSecret, encryptSecret } from "#lib/services/secrets.js";
import { BaseDTO } from "./base-dto";

export interface NewObjectStoreInput {
	accessKeyId: string;
	endpoint: string;
	kind: ObjectStoreKind;
	name: string;
	region: string;
	secretAccessKey: string;
	userId: string;
}

export type ObjectStoreUpdateInput = Partial<
	Pick<ObjectStore, "accessKeyId" | "endpoint" | "name" | "region">
> & {
	secretAccessKey?: string;
};

/** What a page may show of a store: everything but its secret. */
export interface ObjectStoreSummary {
	accessKeyId: string;
	createdAt: Date;
	endpoint: string;
	id: string;
	kind: ObjectStoreKind;
	name: string;
	region: string;
}

/** Wraps the `object_store` table: one S3-compatible connection, the built-in Garage one included. */
export class ObjectStoreDTO extends BaseDTO<ObjectStore> {
	/** Loads one store by id; null when missing. */
	static async get(id: string): Promise<ObjectStoreDTO | null> {
		const [row] = await db
			.select()
			.from(objectStore)
			.where(eq(objectStore.id, id))
			.limit(1);
		return row ? new ObjectStoreDTO(row) : null;
	}

	/** The built-in Garage store's row, or null while Garage has never been turned on. */
	static async builtin(): Promise<ObjectStoreDTO | null> {
		const [row] = await db
			.select()
			.from(objectStore)
			.where(eq(objectStore.kind, "garage"))
			.limit(1);
		return row ? new ObjectStoreDTO(row) : null;
	}

	/** Every store, the built-in one first, then by name. */
	static async list(): Promise<ObjectStoreDTO[]> {
		const rows = await db
			.select()
			.from(objectStore)
			.orderBy(asc(objectStore.name));
		return rows
			.map((row) => new ObjectStoreDTO(row))
			.sort(
				(a, b) => Number(b.kind === "garage") - Number(a.kind === "garage"),
			);
	}

	/** Inserts a store, encrypting its secret access key. */
	static async create(input: NewObjectStoreInput): Promise<ObjectStoreDTO> {
		const now = new Date();
		const row: ObjectStore = {
			accessKeyId: input.accessKeyId,
			createdAt: now,
			endpoint: input.endpoint,
			id: crypto.randomUUID(),
			kind: input.kind,
			name: input.name,
			region: input.region,
			secretAccessKeyEnc: encryptSecret(input.secretAccessKey),
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(objectStore).values(row);
		return new ObjectStoreDTO(row);
	}

	/** Saves edited fields; a blank secret keeps the stored one. */
	async update(input: ObjectStoreUpdateInput): Promise<void> {
		const { secretAccessKey, ...rest } = input;
		const patch = {
			...rest,
			...(secretAccessKey
				? { secretAccessKeyEnc: encryptSecret(secretAccessKey) }
				: {}),
		};
		await db
			.update(objectStore)
			.set(patch)
			.where(eq(objectStore.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes the store row, and with it every state project kept on it. */
	async delete(): Promise<void> {
		await db.delete(objectStore).where(eq(objectStore.id, this.row.id));
	}

	/** The store's id. */
	get id(): string {
		return this.row.id;
	}
	/** Whether this is the built-in Garage store or an external S3-compatible one. */
	get kind(): ObjectStoreKind {
		return this.row.kind;
	}
	/** The store's display name. */
	get name(): string {
		return this.row.name;
	}
	/** The S3 endpoint URL; empty for the built-in store, whose address is resolved at runtime. */
	get endpoint(): string {
		return this.row.endpoint;
	}
	/** The region requests are signed for. */
	get region(): string {
		return this.row.region;
	}
	/** The access key id (not secret). */
	get accessKeyId(): string {
		return this.row.accessKeyId;
	}

	/** The decrypted secret access key, for S3 calls only, never for a page. */
	decryptSecretAccessKey(): string {
		return decryptSecret(this.row.secretAccessKeyEnc) ?? "";
	}

	/** The store without its secret, safe to return from a `load`. */
	summary(): ObjectStoreSummary {
		return {
			accessKeyId: this.row.accessKeyId,
			createdAt: this.row.createdAt,
			endpoint: this.row.endpoint,
			id: this.row.id,
			kind: this.row.kind,
			name: this.row.name,
			region: this.row.region,
		};
	}
}
