import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { normalizeBaseDomain } from "$lib/server/validation/base-domain";
import {
	applyAndRebuild,
	checkbox,
	nullableText,
} from "$lib/server/validation/instance-settings-form";

const logger = new Logger("InstanceSettings");

export const actions = {
	updateCore: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
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
};
