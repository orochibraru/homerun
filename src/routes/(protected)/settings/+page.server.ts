import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ResourceIncidentDTO } from "#lib/dto/resource-incident-dto.js";
import { Logger } from "#lib/logger.js";
import { parseAlertTiming } from "#lib/resource-incidents.js";
import { parseThresholds } from "#lib/resource-thresholds.js";
import { passkeyRpId } from "#lib/security-policy.js";
import { normalizeBaseDomain } from "#lib/server/validation/base-domain.js";
import {
	applyAndRebuild,
	checkbox,
	nullableText,
} from "#lib/server/validation/instance-settings-form.js";
import { AccountSecurityService } from "#lib/services/account-security.service.js";
import { isUiMode } from "#lib/ui-mode.js";
import { isUpdateChannel } from "#lib/update-channel.js";
import { resolve } from "$app/paths";

const logger = new Logger("InstanceSettings");

export const load = async ({ parent }) => {
	await parent();
	const [settings, incidents] = await Promise.all([
		InstanceSettingsDTO.get(),
		ResourceIncidentDTO.recent(10),
	]);
	return {
		passkeyCount: await AccountSecurityService.countAllPasskeys(),
		resourceAlertTiming: {
			reminderMinutes: settings.resourceAlertReminderMinutes,
			sustainSeconds: settings.resourceAlertSustainSeconds,
		},
		resourceIncidents: incidents.map((incident) => incident.toJSON()),
		resourceThresholds: settings.resourceThresholds,
		passkeyRpId: passkeyRpId(config.auth.origin) ?? "localhost",
	};
};

export const actions = {
	updateCore: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		const rawBaseDomain = nullableText(formData, "baseDomain");
		const normalized = rawBaseDomain
			? normalizeBaseDomain(rawBaseDomain)
			: null;
		const baseDomain = normalized?.domain ?? null;
		if (rawBaseDomain && !normalized) {
			return fail(400, {
				error:
					'Base domain must be a bare hostname, like "example.com" or "app.example.local" : no "https://", path, or trailing slash.',
				savedSection: "core",
			});
		}
		// Origin isn't a separate field any more (real bug this replaced :
		// it used to be freeform text that auth.ts's baseURL didn't even
		// read, see auth.ts's buildAuth()) : it's derived straight from the
		// base domain plus the "Use HTTPS" checkbox next to it, so setting
		// one domain is enough.
		const useHttps = checkbox(formData, "useHttps");
		const explicitOrigin = nullableText(formData, "authOrigin");
		if (explicitOrigin && !URL.canParse(explicitOrigin)) {
			return fail(400, {
				error:
					'Dashboard URL must be a full URL, like "https://homerun.example.com" or "http://localhost:5173".',
				savedSection: "core",
			});
		}
		const derivedOrigin = normalized
			? `${useHttps ? "https" : "http"}://${normalized.domain}${
					normalized.port ? `:${normalized.port}` : ""
				}`
			: null;
		const authOrigin = explicitOrigin
			? new URL(explicitOrigin).origin
			: derivedOrigin;
		const settings = await InstanceSettingsDTO.get();
		await settings.updateCore({
			authCheckUrl: nullableText(formData, "authCheckUrl"),
			authCrossSubdomainCookies: checkbox(
				formData,
				"authCrossSubdomainCookies",
			),
			authOrigin,
			baseDomain,
		});
		applyAndRebuild(settings);
		logger.info(`Core instance settings updated: user=${locals.user.id}`);
		return { savedSection: "core", success: true };
	},

	updateChannel: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		const channel = formData.get("updateChannel");
		if (!isUpdateChannel(channel)) {
			return fail(400, {
				error: "Pick the stable, canary or nightly channel.",
				savedSection: "channel",
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateUpdateChannel(channel);
		logger.info(
			`Update channel set: channel=${channel} user=${locals.user.id}`,
		);
		return { savedSection: "channel", success: true };
	},

	updateUiMode: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const mode = (await request.formData()).get("defaultUiMode");
		if (!isUiMode(mode)) {
			return fail(400, {
				error: "Pick simple or advanced.",
				savedSection: "uiMode",
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateDefaultUiMode(mode);
		logger.info(`Default UI mode set: mode=${mode} user=${locals.user.id}`);
		return { savedSection: "uiMode", success: true };
	},

	updateResources: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		const parsed = parseThresholds(
			(name) => formData.get(name) as string | null,
		);
		if (typeof parsed === "string") {
			return fail(400, { error: parsed, savedSection: "resources" });
		}
		const timing = parseAlertTiming(
			(name) => formData.get(name) as string | null,
		);
		if (typeof timing === "string") {
			return fail(400, { error: timing, savedSection: "resources" });
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateResourceThresholds(parsed);
		await settings.updateResourceAlertTiming(timing);
		logger.info(`Resource thresholds saved: user=${locals.user.id}`);
		return { savedSection: "resources", success: true };
	},
};
