import { ErrorIssueDTO } from "#lib/dto/error-issue-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { jsonPage } from "#lib/server/api-pagination.js";
import { parseListQuery } from "#lib/server/list-query.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const query = parseListQuery(url, {
		filterKeys: ["status"],
		perPage: 100,
		sortKeys: ["lastSeen", "firstSeen", "count"],
	});
	const page = await ErrorIssueDTO.listPaged(svc.id, query);
	return jsonPage(page.items, page);
};
