import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import {
	cloudflareInputFromForm,
	newtFieldsError,
	pangolinInputFromForm,
	testCloudflareFromForm,
	testPangolinFromForm,
} from "$lib/server/validation/dns-settings-form";
import {
	applyAndRebuild,
	nullableText,
} from "$lib/server/validation/instance-settings-form";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("InstanceSettings");

export const actions = {
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

	updateTraefik: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const traefikAcmeEmail = nullableText(formData, "traefikAcmeEmail");
		if (
			traefikAcmeEmail &&
			!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(traefikAcmeEmail)
		) {
			return fail(400, {
				error: "ACME account email isn't a valid email address.",
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateTraefik({
			traefikAcmeEmail,
			traefikCertResolver: nullableText(formData, "traefikCertResolver"),
			traefikDynamicConfigDir: nullableText(
				formData,
				"traefikDynamicConfigDir",
			),
			traefikEntrypoint: nullableText(formData, "traefikEntrypoint"),
			traefikHttpCache: formData.get("traefikHttpCache") === "on",
		});
		applyAndRebuild(settings);
		logger.info(`Traefik instance settings updated: user=${locals.user.id}`);

		let traefikDetail: string | null = null;
		try {
			const acme = await DockerService.applyAcmeEmail(traefikAcmeEmail);
			const cache = await DockerService.applyHttpCache(
				settings.toConfigOverride().traefikHttpCache ?? false,
			);
			traefikDetail =
				acme.updated || cache.updated
					? "Traefik was recreated with the new configuration."
					: null;
		} catch (err) {
			traefikDetail = `Saved, but Traefik wasn't reconfigured: ${err instanceof Error ? err.message : String(err)}`;
		}
		return { savedSection: "traefik", success: true, traefikDetail };
	},
};
