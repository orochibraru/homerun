import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import {
	type MigrationEntry,
	type MigrationImportResult,
	type MigrationPreview,
	previewEntries,
	sourceSlug,
} from "$lib/migrate/common";
import { uniqueSlug } from "$lib/slug";
import { ComposeImportService } from "./compose-import.service.ts";

const logger = new Logger("Migration");

class MigrationServiceClass {
	/** Annotates raw migration entries (from a Coolify/Dokploy read) with slug-collision/blocked state against the user's existing services, for the Migrate tab's review step. */
	async preview(
		entries: MigrationEntry[],
		userId: string,
	): Promise<MigrationPreview> {
		const services = await ServiceDTO.list(userId);
		return previewEntries(entries, new Set(services.map((svc) => svc.slug)));
	}

	/**
	 * Imports every non-blocked entry, resolving (or creating) one stack per
	 * distinct source project name (`#stackFor`) and delegating each entry's
	 * services to `ComposeImportService.importPlan`. Never throws: a
	 * per-entry failure is recorded under `skipped` rather than aborting the
	 * rest of the batch.
	 */
	async importEntries(
		entries: MigrationEntry[],
		userId: string,
		sourceLabel: string,
	): Promise<MigrationImportResult> {
		const result: MigrationImportResult = { imported: [], skipped: [] };
		const stacks = new Map<string, string>();
		for (const entry of entries) {
			if (entry.blocked || entry.drafts.length === 0) {
				result.skipped.push({
					name: entry.name,
					reason: entry.blocked ?? "Nothing to import.",
				});
				continue;
			}
			try {
				// biome-ignore lint/performance/noAwaitInLoops: each import checks slugs against rows the previous one just inserted
				const stackId = await this.#stackFor(
					entry.projectName,
					userId,
					sourceLabel,
					stacks,
				);
				const imported = await ComposeImportService.importPlan({
					drafts: entry.drafts,
					stackId,
					stackName: null,
					userId,
				});
				result.imported.push({
					name: entry.name,
					services: imported.services.length,
				});
			} catch (err) {
				result.skipped.push({
					name: entry.name,
					reason: err instanceof Error ? err.message : String(err),
				});
			}
		}
		logger.info(
			`${sourceLabel} import: imported=${result.imported.length} skipped=${result.skipped.length} user=${userId}`,
		);
		return result;
	}

	/** Resolves the stack id for a source project name: an existing stack of the same name, a newly created one, or a cached id from an earlier entry in the same import batch. */
	async #stackFor(
		name: string,
		userId: string,
		sourceLabel: string,
		cache: Map<string, string>,
	): Promise<string> {
		const cached = cache.get(name);
		if (cached) {
			return cached;
		}
		const existing = (await StackDTO.list(userId)).find(
			(row) => row.name === name,
		);
		const id =
			existing?.id ??
			(
				await StackDTO.create({
					description: `Imported from ${sourceLabel}.`,
					name,
					slug: await uniqueSlug(sourceSlug(name), (slug) =>
						StackDTO.slugTaken(slug),
					),
					userId,
				})
			).id;
		cache.set(name, id);
		return id;
	}
}

export const MigrationService = new MigrationServiceClass();
