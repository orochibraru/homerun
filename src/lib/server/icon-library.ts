import { TemplateDTO } from "$lib/dto/template-dto";
import { EXTRA_ICONS, type LibraryIcon } from "$lib/icon-library";

/**
 * Every icon a service can pick: each built-in template's logo (under "Apps"),
 * then the standalone servers, languages and frameworks set, one entry per
 * file.
 */
export async function listIconLibrary(): Promise<LibraryIcon[]> {
	const templates = (await TemplateDTO.listBundledIcons()).map((entry) => ({
		...entry,
		group: "Apps",
	}));
	const taken = new Set(templates.map((entry) => entry.icon));
	return [
		...templates,
		...EXTRA_ICONS.filter((entry) => !taken.has(entry.icon)),
	];
}
