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
import { ComposeImportService } from "./compose-import.service.ts";

const logger = new Logger("Migration");

class MigrationServiceClass {
	async preview(
		entries: MigrationEntry[],
		userId: string,
	): Promise<MigrationPreview> {
		const services = await ServiceDTO.list(userId);
		return previewEntries(entries, new Set(services.map((svc) => svc.slug)));
	}

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
					slug: await this.#uniqueStackSlug(sourceSlug(name)),
					userId,
				})
			).id;
		cache.set(name, id);
		return id;
	}

	async #uniqueStackSlug(slug: string): Promise<string> {
		let candidate = slug;
		let attempt = 2;
		// biome-ignore lint/performance/noAwaitInLoops: each candidate can only be checked once the previous one came back taken
		while (await StackDTO.slugTaken(candidate)) {
			candidate = `${slug.slice(0, 55)}-${attempt}`;
			attempt += 1;
		}
		return candidate;
	}
}

export const MigrationService = new MigrationServiceClass();
