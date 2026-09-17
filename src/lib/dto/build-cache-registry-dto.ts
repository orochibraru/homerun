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

/** `password` blank keeps the stored one, same "leave blank to keep current" convention as the SMTP password on /settings. */
export interface UpdateBuildCacheRegistryInput {
	name: string;
	password?: string;
	registryUrl: string;
	username: string;
}

/** Wraps the `build_cache_registry` table : see ServiceDTO for the pattern this follows. */
export class BuildCacheRegistryDTO extends BaseDTO<BuildCacheRegistry> {
	/** Loads one build cache registry by id; null when missing. */
	static async get(id: string): Promise<BuildCacheRegistryDTO | null> {
		const [row] = await db
			.select()
			.from(buildCacheRegistry)
			.where(eq(buildCacheRegistry.id, id))
			.limit(1);
		return row ? new BuildCacheRegistryDTO(row) : null;
	}

	/** Every build cache registry on the instance, newest first. */
	static async list(): Promise<BuildCacheRegistryDTO[]> {
		const rows = await db
			.select()
			.from(buildCacheRegistry)
			.orderBy(desc(buildCacheRegistry.createdAt));
		return rows.map((row) => new BuildCacheRegistryDTO(row));
	}

	/** One page of `list`, searched server-side, plus the unpaged total. */
	static async listPaged(
		query: ListQuery,
	): Promise<PagedResult<BuildCacheRegistryDTO>> {
		const conditions: SQL[] = [];
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

	/**
	 * Up to `limit` registries whose name, URL or username matches
	 * `q`, newest first, for global search.
	 */
	static async search(
		q: string,
		limit: number,
	): Promise<BuildCacheRegistryDTO[]> {
		const rows = await db
			.select()
			.from(buildCacheRegistry)
			.where(
				searchCondition(q, [
					buildCacheRegistry.name,
					buildCacheRegistry.registryUrl,
					buildCacheRegistry.username,
				]),
			)
			.orderBy(desc(buildCacheRegistry.createdAt))
			.limit(limit);
		return rows.map((row) => new BuildCacheRegistryDTO(row));
	}

	/** Inserts a new registry, encrypting its password before it is stored. */
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

	/**
	 * Saves edited registry fields; a blank password keeps the stored one,
	 * anything else is re-encrypted.
	 */
	async update(input: UpdateBuildCacheRegistryInput): Promise<void> {
		const patch: Partial<BuildCacheRegistry> = {
			name: input.name,
			registryUrl: input.registryUrl,
			updatedAt: new Date(),
			username: input.username,
		};
		if (input.password) {
			patch.passwordEnc = encryptSecret(input.password);
		}
		await db
			.update(buildCacheRegistry)
			.set(patch)
			.where(eq(buildCacheRegistry.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes this registry row. */
	async delete(): Promise<void> {
		await db
			.delete(buildCacheRegistry)
			.where(eq(buildCacheRegistry.id, this.row.id));
	}

	/** The registry's id. */
	get id(): string {
		return this.row.id;
	}
	/** The registry's display name. */
	get name(): string {
		return this.row.name;
	}
	/** The registry host the build cache is pushed to. */
	get registryUrl(): string {
		return this.row.registryUrl;
	}
	/** The username used to authenticate against the registry. */
	get username(): string {
		return this.row.username;
	}

	/** Decrypted password, for a dockerode authconfig only : never exposed to a `load` return value. */
	decryptPassword(): string {
		return decryptSecret(this.row.passwordEnc) ?? "";
	}
}
