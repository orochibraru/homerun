import { desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type RegistryToken, registryToken } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewRegistryTokenInput {
	secretHash: string;
	userId: string;
	username: string;
}

/** Wraps the `registry_token` table : see ServiceDTO for the pattern this follows. */
export class RegistryTokenDTO extends BaseDTO<RegistryToken> {
	/** Loads one token by id; null when missing. */
	static async get(id: string): Promise<RegistryTokenDTO | null> {
		const [row] = await db
			.select()
			.from(registryToken)
			.where(eq(registryToken.id, id))
			.limit(1);
		return row ? new RegistryTokenDTO(row) : null;
	}

	/** Every token on the instance, newest first. */
	static async list(): Promise<RegistryTokenDTO[]> {
		const rows = await db
			.select()
			.from(registryToken)
			.orderBy(desc(registryToken.createdAt));
		return rows.map((row) => new RegistryTokenDTO(row));
	}

	/** Whether a username is already taken, which the registry's htpasswd file can't express twice. */
	static async usernameTaken(username: string): Promise<boolean> {
		const [row] = await db
			.select({ id: registryToken.id })
			.from(registryToken)
			.where(eq(registryToken.username, username))
			.limit(1);
		return Boolean(row);
	}

	/** Creates a token row. The caller hashes the secret and shows the plaintext once; it's never stored. */
	static async create(input: NewRegistryTokenInput): Promise<RegistryTokenDTO> {
		const now = new Date();
		const [row] = await db
			.insert(registryToken)
			.values({
				createdAt: now,
				id: crypto.randomUUID(),
				secretHash: input.secretHash,
				updatedAt: now,
				userId: input.userId,
				username: input.username,
			})
			.returning();
		return new RegistryTokenDTO(row);
	}

	/** The username a `docker login` would use. */
	get username(): string {
		return this.row.username;
	}

	/** The bcrypt hash written into the registry's htpasswd file. */
	get secretHash(): string {
		return this.row.secretHash;
	}

	/** Deletes this token. The caller re-syncs the registry's htpasswd file afterwards, which is what actually revokes it. */
	async delete(): Promise<void> {
		await db.delete(registryToken).where(eq(registryToken.id, this.row.id));
	}
}
