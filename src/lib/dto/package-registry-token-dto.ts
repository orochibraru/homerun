import { and, desc, eq } from "drizzle-orm";

import type { PackageRegistryKind } from "#lib/package-registries.js";
import { db } from "#lib/server/db/lib.js";
import {
	type PackageRegistryToken,
	packageRegistryToken,
} from "#lib/server/db/schema.js";

import { BaseDTO } from "./base-dto";

export interface NewPackageRegistryTokenInput {
	kind: PackageRegistryKind;
	secretHash: string;
	userId: string;
	username: string;
}

/** Wraps the `package_registry_token` table : see ServiceDTO for the pattern this follows. */
export class PackageRegistryTokenDTO extends BaseDTO<PackageRegistryToken> {
	/** Loads one token of a registry by id; null when missing or when it belongs to another registry. */
	static async get(
		kind: PackageRegistryKind,
		id: string,
	): Promise<PackageRegistryTokenDTO | null> {
		const [row] = await db
			.select()
			.from(packageRegistryToken)
			.where(
				and(
					eq(packageRegistryToken.kind, kind),
					eq(packageRegistryToken.id, id),
				),
			)
			.limit(1);
		return row ? new PackageRegistryTokenDTO(row) : null;
	}

	/** Every token of one registry, newest first. */
	static async list(
		kind: PackageRegistryKind,
	): Promise<PackageRegistryTokenDTO[]> {
		const rows = await db
			.select()
			.from(packageRegistryToken)
			.where(eq(packageRegistryToken.kind, kind))
			.orderBy(desc(packageRegistryToken.createdAt));
		return rows.map((row) => new PackageRegistryTokenDTO(row));
	}

	/** Whether a registry already has a token with this username, which its htpasswd file can't hold twice. */
	static async usernameTaken(
		kind: PackageRegistryKind,
		username: string,
	): Promise<boolean> {
		const [row] = await db
			.select({ id: packageRegistryToken.id })
			.from(packageRegistryToken)
			.where(
				and(
					eq(packageRegistryToken.kind, kind),
					eq(packageRegistryToken.username, username),
				),
			)
			.limit(1);
		return Boolean(row);
	}

	/** Creates a token row. The caller hashes the secret and shows the plaintext once; it's never stored. */
	static async create(
		input: NewPackageRegistryTokenInput,
	): Promise<PackageRegistryTokenDTO> {
		const now = new Date();
		const [row] = await db
			.insert(packageRegistryToken)
			.values({
				createdAt: now,
				id: crypto.randomUUID(),
				kind: input.kind,
				secretHash: input.secretHash,
				updatedAt: now,
				userId: input.userId,
				username: input.username,
			})
			.returning();
		return new PackageRegistryTokenDTO(row);
	}

	/** The username a client authenticates with. */
	get username(): string {
		return this.row.username;
	}

	/** The bcrypt hash written into the registry's htpasswd file. */
	get secretHash(): string {
		return this.row.secretHash;
	}

	/** Deletes this token. The caller rewrites the registry's htpasswd file afterwards, which is what actually revokes it. */
	async delete(): Promise<void> {
		await db
			.delete(packageRegistryToken)
			.where(eq(packageRegistryToken.id, this.row.id));
	}
}
