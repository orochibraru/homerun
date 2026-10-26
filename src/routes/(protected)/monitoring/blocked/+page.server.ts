import { fail } from "@sveltejs/kit";

import { BlockedHitDTO } from "#lib/dto/blocked-hit-dto.js";
import { IpBanDTO } from "#lib/dto/ip-ban-dto.js";
import { bannableIp, normalizeIp } from "#lib/ip-bans.js";
import { Logger } from "#lib/logger.js";
import { can, permissionDeniedMessage } from "#lib/permissions.js";
import { parseListQuery } from "#lib/server/list-query.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { IpBanService } from "#lib/services/ip-ban.service.js";

const logger = new Logger("IpBans");

export const load = async ({ parent, url }) => {
	const { ipBans, preferences } = await parent();
	const query = parseListQuery(url, {}, preferences.perPage);
	const [bans, counting] = await Promise.all([
		IpBanDTO.listActivePaged(query),
		BlockedHitDTO.addressesSince(
			new Date(Date.now() - ipBans.windowMinutes * 60_000),
		),
	]);
	return {
		bans: bans.items.map((ban) => ban.toJSON()),
		counting: ipBans.enabled
			? counting.filter((address) => bannableIp(address.ip))
			: [],
		page: bans.page,
		perPage: bans.perPage,
		searching: query.q !== "",
		total: bans.total,
	};
};

export const actions = {
	unban: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		if (!can(locals.permissions, "settings", "write")) {
			return fail(403, { error: permissionDeniedMessage("settings", "write") });
		}
		const ip = normalizeIp(String((await request.formData()).get("ip")));
		if (!(ip && (await IpBanService.unban(ip)))) {
			return fail(404, { error: "That address isn't banned." });
		}
		logger.info(`IP unbanned: ip=${ip} user=${locals.user.id}`);
		return { success: true };
	},

	reportAbuse: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		if (!can(locals.permissions, "settings", "write")) {
			return fail(403, { error: permissionDeniedMessage("settings", "write") });
		}
		const ip = normalizeIp(String((await request.formData()).get("ip")));
		if (!ip) {
			return fail(400, { error: "That isn't an IP address." });
		}
		try {
			const to = await IpBanService.reportAbuse(ip);
			logger.info(`Abuse reported by hand: ip=${ip} user=${locals.user.id}`);
			return { success: true, to };
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : "Couldn't send the report.",
			});
		}
	},
};
