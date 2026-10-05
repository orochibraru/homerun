import { StatusPageDTO } from "#lib/dto/status-page-dto.js";
import type { StatusPagePick } from "#lib/status-page-members.js";
import type { StatusPageScope } from "#lib/types.js";

/** A status page change refused for one field; nothing was saved. */
export class StatusPageSettingsError extends Error {
	constructor(
		readonly field: "slug" | "stackId",
		message: string,
	) {
		super(message);
	}
}

export interface StatusPageSettings {
	description: string | null;
	isPublic: boolean;
	name: string;
	picks: StatusPagePick[];
	scope: StatusPageScope;
	slug: string;
	stackId: string | null;
}

/**
 * Creating and editing status pages, shared by the dashboard's forms and the
 * REST API: a unique slug, a stack for a stack page, and the hand-picked
 * services of a custom one.
 */
class StatusPageSettingsServiceClass {
	/**
	 * Creates a status page.
	 *
	 * @throws {StatusPageSettingsError} When the slug is taken or a stack
	 *   page has no stack.
	 */
	async create(
		input: StatusPageSettings,
		userId: string,
	): Promise<StatusPageDTO> {
		await this.#check(input, null);
		const page = await StatusPageDTO.create({
			...this.#columns(input),
			userId,
		});
		if (input.scope === "custom") {
			await page.setPicks(input.picks);
		}
		return page;
	}

	/**
	 * Replaces a status page's settings with `input`.
	 *
	 * @throws {StatusPageSettingsError} When the slug is taken or a stack
	 *   page has no stack.
	 */
	async update(page: StatusPageDTO, input: StatusPageSettings): Promise<void> {
		await this.#check(input, page.id);
		await page.update(this.#columns(input));
		if (input.scope === "custom") {
			await page.setPicks(input.picks);
		}
	}

	/** The row columns of `input`: a stack only for a stack page. */
	#columns(input: StatusPageSettings) {
		return {
			description: input.description || null,
			isPublic: input.isPublic,
			name: input.name,
			scope: input.scope,
			slug: input.slug,
			stackId: input.scope === "stack" ? input.stackId : null,
		};
	}

	/** A free slug, and a stack for a stack page. */
	async #check(
		input: StatusPageSettings,
		exceptId: string | null,
	): Promise<void> {
		if (await StatusPageDTO.slugTaken(input.slug, exceptId ?? undefined)) {
			throw new StatusPageSettingsError("slug", "That slug is already taken.");
		}
		if (input.scope === "stack" && !input.stackId) {
			throw new StatusPageSettingsError(
				"stackId",
				"Pick the stack this page covers.",
			);
		}
	}
}

export const StatusPageSettingsService = new StatusPageSettingsServiceClass();
