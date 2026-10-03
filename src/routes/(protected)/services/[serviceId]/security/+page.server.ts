import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { ImageScanDTO } from "#lib/dto/image-scan-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import { invalidateGatedService } from "#lib/server/gated-service-cache.js";
import {
	loginWallAvailability,
	loginWallOptions,
	parseLoginWallForm,
} from "#lib/server/login-wall-form.js";
import { DeploymentService } from "#lib/services/deploy.service.js";
import { ImageScanService } from "#lib/services/image-scan.service.js";
import { resolve } from "$app/paths";

const logger = new Logger("ImageScan");
const accessLogger = new Logger("Services");

export const load = async ({ locals, params, parent }) => {
	await parent();
	const [scans, scanning, settings, wall] = await Promise.all([
		ImageScanDTO.listForService(params.serviceId, 15),
		ImageScanService.isScanning(params.serviceId),
		InstanceSettingsDTO.get(),
		loginWallOptions(),
	]);
	return {
		...wall,
		blockPolicy: settings.imageScanBlockPolicy,
		instanceScanEnabled: settings.imageScanEnabled,
		isAdmin: locals.isAdmin,
		scanning,
		scans: scans.map((scan) => scan.toJSON()),
	};
};

export const actions = {
	scan: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (!(svc.containerId || svc.swarmServiceId)) {
			return fail(400, {
				error: "Deploy the service first : there's no deployed image to scan.",
			});
		}
		const job = await ImageScanService.enqueueScan(svc, locals.user.id);
		logger.info(
			`Image scan queued: service=${svc.id} job=${job.id} user=${locals.user.id}`,
		);
		return { queued: true };
	},
	updateAppAuth: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const parsed = parseLoginWallForm(
			await request.formData(),
			await loginWallAvailability(),
			config.auth.origin,
		);
		if ("error" in parsed) {
			return fail(400, { authError: parsed.error });
		}
		const { policy } = parsed;

		const wasRequired = svc.authRequired;
		await svc.update(policy);
		invalidateGatedService(svc.id);

		const redeploying = await DeploymentService.redeployIfLoginWallChanged(
			svc,
			wasRequired,
			locals.user.id,
		);

		accessLogger.info(
			`App access updated: service=${svc.id} authRequired=${policy.authRequired} methods=${policy.authProviders.join("|") || "none"} user=${locals.user.id}`,
		);

		return { authSuccess: true, redeploying };
	},
};
