import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config, envDefaultsForDisplay } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import {
	cloudflareInputFromForm,
	newtFieldsError,
	pangolinInputFromForm,
	testCloudflareFromForm,
	testPangolinFromForm,
} from "$lib/server/validation/dns-settings-form";
import { applyAndRebuild } from "$lib/server/validation/instance-settings-form";
import { CloudflareService } from "$lib/services/cloudflare.service";
import { PangolinService } from "$lib/services/pangolin.service";

const logger = new Logger("InstanceSettings");

/** The active provider's domains, or the reason they couldn't be listed. */
async function providerDomains(
	provider: "cloudflare" | "pangolin" | null,
): Promise<{ domains: string[]; error: string | null }> {
	if (!provider) {
		return { domains: [], error: null };
	}
	try {
		const domains =
			provider === "cloudflare"
				? await CloudflareService.listZoneNames()
				: await PangolinService.listDomainNames();
		return {
			domains: domains ?? [],
			error: domains ? null : "Finish the settings below to list domains.",
		};
	} catch (err) {
		return {
			domains: [],
			error: err instanceof Error ? err.message : "Couldn't list domains.",
		};
	}
}

export const load = async ({ locals, parent }) => {
	await parent();
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	const settings = await InstanceSettingsDTO.get();
	return {
		domains: providerDomains(settings.dnsProvider),
		envDefaults: envDefaultsForDisplay(),
		provider: settings.dnsProvider,
		settings: settings.toJSON(),
	};
};

export const actions = {
	setProvider: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const raw = String((await request.formData()).get("provider") ?? "");
		if (raw !== "" && raw !== "cloudflare" && raw !== "pangolin") {
			return fail(400, { error: "Pick Cloudflare, Pangolin or none." });
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateDnsProvider(raw === "" ? null : raw);
		applyAndRebuild(settings);
		logger.info(
			`DNS provider set: provider=${raw || "none"} user=${locals.user.id}`,
		);
		return { success: true };
	},

	testCloudflare: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const outcome = await testCloudflareFromForm(
			await request.formData(),
			await InstanceSettingsDTO.get(),
			config.baseDomain,
		);
		if (!outcome.ok) {
			return fail(400, { error: outcome.error });
		}
		return {
			cloudflareTestDetail: outcome.detail,
			cloudflareTestOk: true,
			success: true,
		};
	},
	testPangolin: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const outcome = await testPangolinFromForm(
			await request.formData(),
			await InstanceSettingsDTO.get(),
			config.baseDomain,
		);
		if (!outcome.ok) {
			return fail(400, { error: outcome.error });
		}
		return {
			pangolinTestDetail: outcome.detail,
			pangolinTestOk: true,
			success: true,
		};
	},
	updateCloudflare: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateCloudflare(cloudflareInputFromForm(formData));
		logger.info(`Cloudflare instance settings updated: user=${locals.user.id}`);
		return { savedSection: "cloudflare", success: true };
	},
	updatePangolin: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		const newtError = newtFieldsError(formData, settings);
		if (newtError) {
			return fail(400, { error: newtError });
		}
		await settings.updatePangolin(pangolinInputFromForm(formData));
		applyAndRebuild(settings);
		logger.info(`Pangolin instance settings updated: user=${locals.user.id}`);
		return { savedSection: "pangolin", success: true };
	},
};
