import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { BlockedHitDTO } from "#lib/dto/blocked-hit-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { IpBanDTO } from "#lib/dto/ip-ban-dto.js";
import { normalizeIp } from "#lib/ip-bans.js";
import { Logger } from "#lib/logger.js";
import { IpBanService } from "#lib/services/ip-ban.service.js";
import { resolve } from "$app/paths";

const logger = new Logger("IpBans");

export const load = async ({ parent }) => {
	const { user } = await parent();
	if (user.role !== "admin") {
		throw redirect(302, resolve("/(protected)/monitoring"));
	}
	const settings = (await InstanceSettingsDTO.get()).ipBans;
	const [bans, counting] = await Promise.all([
		IpBanDTO.listActive(),
		BlockedHitDTO.addressesSince(
			new Date(Date.now() - settings.windowMinutes * 60_000),
		),
	]);
	return {
		bans: bans.map((ban) => ban.toJSON()),
		counting,
		ipBans: settings,
		published: Boolean(config.traefik.dynamicConfigDir),
	};
};

export const actions = {
	unban: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const ip = normalizeIp(String((await request.formData()).get("ip")));
		if (!(ip && (await IpBanService.unban(ip)))) {
			return fail(404, { error: "That address isn't banned." });
		}
		logger.info(`IP unbanned: ip=${ip} user=${locals.user.id}`);
		return { success: true };
	},
};
