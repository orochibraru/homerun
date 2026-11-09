import { formatLogLines } from "#lib/logs/history.js";
import { can } from "#lib/permissions.js";
import { LogHistoryService } from "#lib/services/log-history.service.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}
	if (!can(locals.permissions, "system", "read")) {
		return new Response("Forbidden", { status: 403 });
	}
	let lines;
	try {
		lines = await LogHistoryService.collect(
			{ system: params.system },
			url.searchParams,
			"24h",
		);
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : String(error),
			{ status: 400 },
		);
	}
	return new Response(formatLogLines(lines), {
		headers: {
			"Cache-Control": "no-store",
			"Content-Disposition": `attachment; filename="${params.system.replaceAll(/[^\w.-]/g, "_")}-logs.txt"`,
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
