import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";

import { config, isSmtpEnabled } from "#lib/config.js";
import { BlockedHitDTO } from "#lib/dto/blocked-hit-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { IpBanDTO } from "#lib/dto/ip-ban-dto.js";
import { BLOCKED_STATS_DAYS } from "#lib/ip-bans.js";
import { can } from "#lib/permissions.js";

export const load = async ({ locals, parent }) => {
	await parent();
	if (!can(locals.permissions, "settings", "read")) {
		throw redirect(302, resolve("/(protected)/monitoring"));
	}
	const [settings, summary, perService, banCount] = await Promise.all([
		InstanceSettingsDTO.get(),
		BlockedHitDTO.summarySince(
			new Date(Date.now() - BLOCKED_STATS_DAYS * 86_400_000),
		),
		BlockedHitDTO.bannedPerService(),
		IpBanDTO.countActive(),
	]);
	return {
		banCount,
		ipBans: settings.ipBans,
		perService,
		published: Boolean(config.traefik.dynamicConfigDir),
		smtpEnabled: isSmtpEnabled(),
		statsDays: BLOCKED_STATS_DAYS,
		summary,
	};
};
