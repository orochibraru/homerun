import { json } from "@sveltejs/kit";
import { TemplateDTO } from "$lib/dto/template-dto";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const query = parseApiListQuery(url);
	const [builtins, mine] = await Promise.all([
		TemplateDTO.listPaged(locals.user.id, "builtin", query),
		TemplateDTO.listPaged(locals.user.id, "mine", query),
	]);
	return jsonPage(
		[...builtins.items, ...mine.items].map((t) => t.toJSON()),
		{
			page: query.page,
			perPage: query.perPage,
			total: builtins.total + mine.total,
		},
	);
};
