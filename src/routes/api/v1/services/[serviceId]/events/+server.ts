import { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceEventDTO } from "#lib/dto/service-event-dto.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const limit = Number(url.searchParams.get("limit") ?? 50);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		return Response.json(
			{ error: "limit must be a whole number from 1 to 100." },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const events = await ServiceEventDTO.listForService(svc.id, null, limit);
	return Response.json(
		events.toReversed().map((event) => {
			const row = event.toJSON();
			return {
				actorName: row.actorName,
				createdAt: row.createdAt,
				detail: row.detail,
				id: row.id,
				kind: row.kind,
				lane: row.lane,
				summary: row.summary,
			};
		}),
	);
};
