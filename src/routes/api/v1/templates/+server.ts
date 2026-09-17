import { json } from "@sveltejs/kit";
import { TemplateDTO } from "$lib/dto/template-dto";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const query = parseApiListQuery(url);
	const [builtins, custom] = await Promise.all([
		TemplateDTO.listPaged("builtin", query),
		TemplateDTO.listPaged("custom", query),
	]);
	return jsonPage(
		[...builtins.items, ...custom.items].map((t) => t.toJSON()),
		{
			page: query.page,
			perPage: query.perPage,
			total: builtins.total + custom.total,
		},
	);
};
