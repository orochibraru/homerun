import { forwardedHost } from "#lib/error-pages.js";
import { Logger } from "#lib/logger.js";
import { ErrorPageService } from "#lib/services/error-page.service.js";
import { IpBanService } from "#lib/services/ip-ban.service.js";

const logger = new Logger("IpBans");

export const fallback = async ({ request }) => {
	const host = forwardedHost(request.headers);
	await IpBanService.recordBlockedHit(request.headers, host).catch((err) =>
		logger.error("Couldn't record a blocked request", err),
	);
	return await ErrorPageService.respond(403, host, "blocked");
};
