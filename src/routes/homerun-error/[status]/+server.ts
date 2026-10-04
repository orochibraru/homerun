import { ERROR_PAGE_KINDS } from "#lib/error-pages.js";
import { ErrorPageService } from "#lib/services/error-page.service.js";

export const GET = async ({ params, request, url }) => {
	const status = Number(params.status);
	const host = (
		request.headers.get("x-forwarded-host") ?? request.headers.get("host")
	)
		?.split(",")[0]
		?.trim()
		.replace(/:\d+$/, "")
		.toLowerCase();
	const preview = ERROR_PAGE_KINDS.find(
		({ kind }) => kind === url.searchParams.get("preview"),
	)?.kind;
	return await ErrorPageService.respond(
		Number.isInteger(status) && status >= 400 && status <= 599 ? status : 404,
		host || null,
		preview ?? null,
	);
};
