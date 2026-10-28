import { ServiceDTO } from "#lib/dto/service-dto.js";
import {
	InvalidLogPatternError,
	ServiceLogDTO,
} from "#lib/dto/service-log-dto.js";
import { parseLogHistoryQuery } from "#lib/logs/history.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	let query;
	try {
		query = parseLogHistoryQuery(url.searchParams);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	try {
		return Response.json(await ServiceLogDTO.search(svc.id, query), {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		if (error instanceof InvalidLogPatternError) {
			return Response.json({ error: error.message }, { status: 400 });
		}
		throw error;
	}
};
