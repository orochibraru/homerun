import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import {
	applyAndRebuild,
	checkbox,
	nullableText,
} from "$lib/server/validation/instance-settings-form";
import { CloudflareService } from "$lib/services/cloudflare.service";
import { DockerService } from "$lib/services/docker.service";
import { PangolinService } from "$lib/services/pangolin.service";

const logger = new Logger("InstanceSettings");

export const actions = {
	testCloudflare: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const zoneId = (formData.get("cloudflareZoneId") as string | null)?.trim();
		const tokenInput = (
			formData.get("cloudflareApiToken") as string | null
		)?.trim();
		if (!zoneId) {
			return fail(400, { error: "Enter a zone id first." });
		}
		const settings = await InstanceSettingsDTO.get();
		const token = tokenInput || settings.decryptCloudflareApiToken();
		if (!token) {
			return fail(400, { error: "Enter an API token first." });
		}
		const result = await CloudflareService.verifyZoneAccess(token, zoneId);
		if (!result.success) {
			return fail(400, {
				error: `Couldn't verify zone access: ${result.error}`,
			});
		}
		return { cloudflareTestOk: true, success: true };
	},

	testPangolin: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const baseUrl = (
			formData.get("pangolinApiBaseUrl") as string | null
		)?.trim();
		const orgId = (formData.get("pangolinOrgId") as string | null)?.trim();
		const tokenInput = (
			formData.get("pangolinApiToken") as string | null
		)?.trim();
		if (!(baseUrl && orgId)) {
			return fail(400, { error: "Enter an API base URL and org id first." });
		}
		const settings = await InstanceSettingsDTO.get();
		const token = tokenInput || settings.decryptPangolinApiToken();
		if (!token) {
			return fail(400, { error: "Enter an API token first." });
		}
		// Deliberately checks the *whole* configuration, not just that the
		// token authenticates : the site name and a domain covering this
		// instance's base domain are both required for a single resource to
		// ever be created, so a test that skipped them passed on a setup that
		// could never work.
		const result = await PangolinService.verifyConnection({
			baseDomain: config.baseDomain,
			baseUrl,
			orgId,
			siteName:
				(formData.get("pangolinMainSiteName") as string | null)?.trim() || null,
			token,
		});
		if (!result.success) {
			return fail(400, { error: result.error });
		}
		return {
			pangolinTestDetail: result.detail ?? null,
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
		await settings.updateCloudflare({
			cloudflareApiToken:
				(formData.get("cloudflareApiToken") as string | null)?.trim() ||
				undefined,
			cloudflareZoneId: nullableText(formData, "cloudflareZoneId"),
		});
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
		const portRaw = (
			formData.get("pangolinTargetPort") as string | null
		)?.trim();
		const port = portRaw ? Number.parseInt(portRaw, 10) : null;
		const settings = await InstanceSettingsDTO.get();
		await settings.updatePangolin({
			pangolinApiBaseUrl: nullableText(formData, "pangolinApiBaseUrl"),
			pangolinApiToken:
				(formData.get("pangolinApiToken") as string | null)?.trim() ||
				undefined,
			pangolinMainSiteName: nullableText(formData, "pangolinMainSiteName"),
			pangolinOrgId: nullableText(formData, "pangolinOrgId"),
			pangolinOwnsAuth: checkbox(formData, "pangolinOwnsAuth"),
			pangolinTargetHost: nullableText(formData, "pangolinTargetHost"),
			pangolinTargetPort: Number.isFinite(port) ? port : null,
		});
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
		});
		applyAndRebuild(settings);
		logger.info(`Traefik instance settings updated: user=${locals.user.id}`);

		let traefikDetail: string | null = null;
		try {
			const applied = await DockerService.applyAcmeEmail(traefikAcmeEmail);
			traefikDetail = applied.updated ? applied.message : null;
		} catch (err) {
			traefikDetail = `Saved, but Traefik wasn't reconfigured: ${err instanceof Error ? err.message : String(err)}`;
		}
		return { savedSection: "traefik", success: true, traefikDetail };
	},
};
