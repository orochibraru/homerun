import { ServiceDTO } from "#lib/dto/service-dto.js";
import { formatLogLines } from "#lib/logs/history.js";
import { LogHistoryService } from "#lib/services/log-history.service.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return new Response("Not found", { status: 404 });
	}
	let lines;
	try {
		lines = await LogHistoryService.collect(svc.id, url.searchParams, "24h");
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : String(error),
			{
				status: 400,
			},
		);
	}
	return new Response(formatLogLines(lines), {
		headers: {
			"Cache-Control": "no-store",
			"Content-Disposition": `attachment; filename="${svc.slug}-logs.txt"`,
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
