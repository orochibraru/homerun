import { StackDTO } from "#lib/dto/stack-dto.js";
import { Logger } from "#lib/logger.js";
import { listIconLibrary } from "#lib/server/icon-library.js";
import { iconProblem } from "#lib/service-icon.js";

const logger = new Logger("Stacks");
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

/** A stack change refused for the caller's input; nothing was saved. */
export class StackSettingsError extends Error {}

export interface StackSettingsInput {
	description?: string | null;
	icon?: string | null;
	name?: string;
	parentId?: string | null;
	slug?: string;
}

/**
 * Creating and changing stacks, shared by the dashboard's stack forms and the
 * REST API: a name, a unique slug, an icon from the library or an upload, and
 * a parent that doesn't make a loop.
 */
class StackSettingsServiceClass {
	/**
	 * Creates a stack, nested in `parentId` when given.
	 *
	 * @throws {StackSettingsError} When a field is invalid or the slug taken.
	 */
	async create(
		input: StackSettingsInput & { name: string; slug: string },
		userId: string,
	): Promise<StackDTO> {
		await this.#check(null, input);
		if (input.parentId && !(await StackDTO.get(input.parentId))) {
			throw new StackSettingsError("That parent stack no longer exists.");
		}
		const stack = await StackDTO.create({
			description: input.description?.trim() || null,
			name: input.name.trim(),
			parentId: input.parentId ?? null,
			slug: input.slug,
			userId,
		});
		if (input.icon) {
			await stack.update({ icon: input.icon });
		}
		logger.info(
			`Stack created: stack=${stack.id} parent=${input.parentId ?? "none"} user=${userId}`,
		);
		return stack;
	}

	/**
	 * Applies the fields `input` carries to `stack`, leaving the rest alone.
	 *
	 * @throws {StackSettingsError} When a field is invalid, the slug taken or
	 *   the parent would make a loop; nothing is saved then.
	 */
	async apply(stack: StackDTO, input: StackSettingsInput): Promise<void> {
		await this.#check(stack, input);
		const { parentId, ...fields } = input;
		if (parentId !== undefined && parentId !== stack.parentId) {
			try {
				await stack.setParent(parentId);
			} catch (err) {
				throw new StackSettingsError(
					err instanceof Error ? err.message : String(err),
				);
			}
		}
		const patch = {
			...fields,
			...(fields.name === undefined ? {} : { name: fields.name.trim() }),
			...(fields.description === undefined
				? {}
				: { description: fields.description?.trim() || null }),
			...(fields.icon === undefined ? {} : { icon: fields.icon || null }),
		};
		if (Object.keys(patch).length > 0) {
			await stack.update(patch);
		}
	}

	/** Name, slug and icon. */
	async #check(
		stack: StackDTO | null,
		input: StackSettingsInput,
	): Promise<void> {
		if (input.name !== undefined && !input.name.trim()) {
			throw new StackSettingsError("Name is required.");
		}
		if (input.slug !== undefined && !SLUG_RE.test(input.slug)) {
			throw new StackSettingsError(
				"Slug must be lowercase letters, numbers, and hyphens only.",
			);
		}
		if (
			input.slug !== undefined &&
			input.slug !== stack?.slug &&
			(await StackDTO.slugTaken(input.slug, stack?.id))
		) {
			throw new StackSettingsError("That slug is already in use.");
		}
		if (input.icon && input.icon !== stack?.icon) {
			const bundled = (await listIconLibrary()).map((entry) => entry.icon);
			const problem = iconProblem(input.icon, bundled);
			if (problem) {
				throw new StackSettingsError(problem);
			}
		}
	}
}

export const StackSettingsService = new StackSettingsServiceClass();
