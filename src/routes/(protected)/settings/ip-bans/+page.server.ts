import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { IpBanDTO } from "#lib/dto/ip-ban-dto.js";
import {
	DEFAULT_IP_BAN_SETTINGS,
	MAX_BAN_WINDOW_MINUTES,
	normalizeIp,
} from "#lib/ip-bans.js";
import { Logger } from "#lib/logger.js";
import { IpBanService } from "#lib/services/ip-ban.service.js";
import { resolve } from "$app/paths";

const logger = new Logger("IpBans");

export const load = async () => {
	const [settings, bans] = await Promise.all([
		InstanceSettingsDTO.get(),
		IpBanDTO.listActive(),
	]);
	return {
		bans: bans.map((ban) => ban.toJSON()),
		defaults: DEFAULT_IP_BAN_SETTINGS,
		ipBans: settings.ipBans,
		maxWindowMinutes: MAX_BAN_WINDOW_MINUTES,
		published: Boolean(config.traefik.dynamicConfigDir),
	};
};

function wholeNumber(
	formData: FormData,
	name: string,
	min: number,
	max: number,
): number | null {
	const value = Number(String(formData.get(name) ?? "").trim());
	return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export const actions = {
	updateIpBans: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve(""));
		}
		const formData = await request.formData();
		const threshold = wholeNumber(formData, "threshold", 1, 1000);
		const windowMinutes = wholeNumber(
			formData,
			"windowMinutes",
			1,
			MAX_BAN_WINDOW_MINUTES,
		);
		const durationHours = wholeNumber(formData, "durationHours", 0, 8760);
		if (threshold === null) {
			return fail(400, { error: "Blocked requests must be 1 to 1000." });
		}
		if (windowMinutes === null) {
			return fail(400, {
				error: `The window must be 1 to ${MAX_BAN_WINDOW_MINUTES} minutes.`,
			});
		}
		if (durationHours === null) {
			return fail(400, {
				error: "The ban length must be 0 (forever) to 8760 hours.",
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateIpBans({
			durationHours,
			enabled: formData.get("enabled") === "on",
			threshold,
			windowMinutes,
		});
		logger.info(`IP ban settings updated: user=${locals.user.id}`);
		return { success: true };
	},

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
