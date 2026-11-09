import { eq } from "drizzle-orm";

import type { PackageRegistryKind } from "#lib/package-registries.js";
import { db } from "#lib/server/db/lib.js";
import {
	type PackageRegistry,
	packageRegistry,
} from "#lib/server/db/schema.js";

import { BaseDTO } from "./base-dto";

export interface PackageRegistrySettingsInput {
	enabled: boolean;
	publicHost: string | null;
}

/** Wraps the `package_registry` table, one row per registry kind that was ever configured : see ServiceDTO for the pattern this follows. */
export class PackageRegistryDTO extends BaseDTO<PackageRegistry> {
	/** Loads one registry's settings; null when it was never configured. */
	static async get(
		kind: PackageRegistryKind,
	): Promise<PackageRegistryDTO | null> {
		const [row] = await db
			.select()
			.from(packageRegistry)
			.where(eq(packageRegistry.kind, kind))
			.limit(1);
		return row ? new PackageRegistryDTO(row) : null;
	}

	/** Every configured registry, on or off. */
	static async list(): Promise<PackageRegistryDTO[]> {
		const rows = await db.select().from(packageRegistry);
		return rows.map((row) => new PackageRegistryDTO(row));
	}

	/** Creates or replaces one registry's settings. */
	static async save(
		kind: PackageRegistryKind,
		input: PackageRegistrySettingsInput,
	): Promise<PackageRegistryDTO> {
		const now = new Date();
		const [row] = await db
			.insert(packageRegistry)
			.values({
				createdAt: now,
				enabled: input.enabled,
				kind,
				publicHost: input.publicHost,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				set: {
					enabled: input.enabled,
					publicHost: input.publicHost,
					updatedAt: now,
				},
				target: packageRegistry.kind,
			})
			.returning();
		return new PackageRegistryDTO(row);
	}

	/** Which registry this row configures. */
	get kind(): PackageRegistryKind {
		return this.row.kind;
	}

	/** Whether the registry's container should be running. */
	get enabled(): boolean {
		return this.row.enabled;
	}

	/** The hostname Traefik routes to the registry, null when it isn't published. */
	get publicHost(): string | null {
		return this.row.publicHost;
	}
}
