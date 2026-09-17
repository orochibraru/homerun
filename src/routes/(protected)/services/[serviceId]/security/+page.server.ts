import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { ImageScanService } from "$lib/services/image-scan.service";

const logger = new Logger("ImageScan");

export const load = async ({ locals, params, parent }) => {
	await parent();
	const [scans, scanning, settings] = await Promise.all([
		ImageScanDTO.listForService(params.serviceId, 15),
		ImageScanService.isScanning(params.serviceId),
		InstanceSettingsDTO.get(),
	]);
	return {
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
			throw redirect(302, resolve("/auth/sign-in"));
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
};
