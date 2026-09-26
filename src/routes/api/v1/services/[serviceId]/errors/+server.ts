import { json } from "@sveltejs/kit";
import { ErrorIssueDTO } from "$lib/dto/error-issue-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { jsonPage } from "$lib/server/api-pagination";
import { parseListQuery } from "$lib/server/list-query";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const query = parseListQuery(url, {
		filterKeys: ["status"],
		perPage: 100,
		sortKeys: ["lastSeen", "firstSeen", "count"],
	});
	const page = await ErrorIssueDTO.listPaged(svc.id, query);
	return jsonPage(page.items, page);
};
