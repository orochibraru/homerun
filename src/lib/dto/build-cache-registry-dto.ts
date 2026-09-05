import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type BuildCacheRegistry,
	buildCacheRegistry,
} from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { decryptSecret, encryptSecret } from "$lib/services/secrets";
import { BaseDTO } from "./base-dto";

export interface NewBuildCacheRegistryInput {
	name: string;
	password: string;
	registryUrl: string;
	userId: string;
	username: string;
}

/** Wraps the `build_cache_registry` table : see ServiceDTO for the pattern this follows. */
export class BuildCacheRegistryDTO extends BaseDTO<BuildCacheRegistry> {
	static async get(
		id: string,
		userId: string,
	): Promise<BuildCacheRegistryDTO | null> {
		const [row] = await db
			.select()
			.from(buildCacheRegistry)
			.where(
				and(
					eq(buildCacheRegistry.id, id),
					eq(buildCacheRegistry.userId, userId),
				),
			)
			.limit(1);
		return row ? new BuildCacheRegistryDTO(row) : null;
	}

	static async list(userId: string): Promise<BuildCacheRegistryDTO[]> {
		const rows = await db
			.select()
			.from(buildCacheRegistry)
			.where(eq(buildCacheRegistry.userId, userId))
			.orderBy(desc(buildCacheRegistry.createdAt));
		return rows.map((row) => new BuildCacheRegistryDTO(row));
	}

	/** One page of `list`, searched server-side, plus the unpaged total. */
	static async listPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<BuildCacheRegistryDTO>> {
		const conditions: SQL[] = [eq(buildCacheRegistry.userId, userId)];
		const search = searchCondition(query.q, [
			buildCacheRegistry.name,
			buildCacheRegistry.registryUrl,
			buildCacheRegistry.username,
		]);
		if (search) {
			conditions.push(search);
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(buildCacheRegistry)
				.where(where)
				.orderBy(desc(buildCacheRegistry.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(buildCacheRegistry).where(where),
		]);

		return {
			items: rows.map((row) => new BuildCacheRegistryDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	static async create(
		input: NewBuildCacheRegistryInput,
	): Promise<BuildCacheRegistryDTO> {
		const now = new Date();
		const row: BuildCacheRegistry = {
			createdAt: now,
			id: crypto.randomUUID(),
			name: input.name,
			passwordEnc: encryptSecret(input.password),
			registryUrl: input.registryUrl,
			updatedAt: now,
			userId: input.userId,
			username: input.username,
		};
		await db.insert(buildCacheRegistry).values(row);
		return new BuildCacheRegistryDTO(row);
	}

	async delete(): Promise<void> {
		await db
			.delete(buildCacheRegistry)
			.where(eq(buildCacheRegistry.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get name(): string {
		return this.row.name;
	}
	get registryUrl(): string {
		return this.row.registryUrl;
	}
	get username(): string {
		return this.row.username;
	}

	/** Decrypted password, for a dockerode authconfig only : never exposed to a `load` return value. */
	decryptPassword(): string {
		return decryptSecret(this.row.passwordEnc) ?? "";
	}
}
