import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { isBlockSeverity } from "$lib/image-scan";
import { Logger } from "$lib/logger";
import { MAX_RETAINED_IMAGES, MIN_RETAINED_IMAGES } from "$lib/revisions";
import {
	applyAndRebuild,
	nullableText,
} from "$lib/server/validation/instance-settings-form";
import { DockerService } from "$lib/services/docker.service";

const logger = new Logger("InstanceSettings");

export const actions = {
	updateDocker: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateDocker({
			dockerNetworkName: nullableText(formData, "dockerNetworkName"),
			dockerSocketPath: nullableText(formData, "dockerSocketPath"),
		});
		applyAndRebuild(settings);
		logger.info(`Docker instance settings updated: user=${locals.user.id}`);
		return { savedSection: "docker", success: true };
	},

	updateImageScan: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const severity = formData.get("imageScanBlockSeverity");
		if (severity !== "off" && !isBlockSeverity(severity)) {
			return fail(400, { error: "Invalid block policy." });
		}
		const imageScanEnabled = formData.get("imageScanEnabled") === "on";
		const imageScanBlockFixableOnly =
			formData.get("imageScanBlockFixableOnly") === "on";
		const imageScanRequired = formData.get("imageScanRequired") === "on";
		const settings = await InstanceSettingsDTO.get();
		await settings.updateImageScan({
			imageScanBlockFixableOnly,
			imageScanBlockSeverity: isBlockSeverity(severity) ? severity : null,
			imageScanEnabled,
			imageScanRequired,
		});
		logger.info(
			`Image scanning updated: enabled=${imageScanEnabled} block=${severity} fixableOnly=${imageScanBlockFixableOnly} required=${imageScanRequired} user=${locals.user.id}`,
		);
		return { savedSection: "imageScan", success: true };
	},

	updateRetainedImages: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const count = Number(formData.get("retainedImagesPerService"));
		if (
			!Number.isInteger(count) ||
			count < MIN_RETAINED_IMAGES ||
			count > MAX_RETAINED_IMAGES
		) {
			return fail(400, {
				error: `Keep between ${MIN_RETAINED_IMAGES} and ${MAX_RETAINED_IMAGES} images per service.`,
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateRetainedImages(count);
		logger.info(
			`Retained images per service updated: count=${count} user=${locals.user.id}`,
		);
		return { savedSection: "retainedImages", success: true };
	},

	updateOrchestration: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const mode = formData.get("orchestrationMode") as string | null;
		if (mode !== "standalone" && mode !== "swarm") {
			return fail(400, { error: "Invalid orchestration mode." });
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateOrchestrationMode(mode);
		logger.info(
			`Orchestration mode updated: mode=${mode} user=${locals.user.id}`,
		);

		try {
			const steps =
				mode === "swarm"
					? await DockerService.enableSwarmMode()
					: await DockerService.disableSwarmMode();
			return {
				orchestrationSteps: steps,
				savedSection: "orchestration",
				success: true,
			};
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			logger.error(`Applying orchestration mode failed: ${detail}`);
			return fail(500, {
				error: `Mode saved, but the host couldn't be prepared: ${detail}`,
			});
		}
	},
};
