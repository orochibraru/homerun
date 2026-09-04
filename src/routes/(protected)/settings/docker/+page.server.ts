import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import {
	applyAndRebuild,
	checkbox,
	nullableText,
} from "$lib/server/validation/instance-settings-form";

const logger = new Logger("InstanceSettings");

export const actions = {
	updateAutoscale: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const overflowRemoteHostId =
			(formData.get("autoscaleOverflowRemoteHostId") as string | null) || null;
		const cpuThreshold = Number.parseInt(
			(formData.get("autoscaleCpuThresholdPercent") as string | null) ?? "80",
			10,
		);
		const memThreshold = Number.parseInt(
			(formData.get("autoscaleMemoryThresholdPercent") as string | null) ??
				"80",
			10,
		);

		if (overflowRemoteHostId) {
			const host = await RemoteHostDTO.get(
				overflowRemoteHostId,
				locals.user.id,
			);
			if (!host) {
				return fail(400, { error: "That remote host wasn't found." });
			}
		}

		const settings = await InstanceSettingsDTO.get();
		await settings.updateAutoscale({
			autoscaleCpuThresholdPercent: Number.isFinite(cpuThreshold)
				? Math.min(99, Math.max(1, cpuThreshold))
				: 80,
			autoscaleEnabled: checkbox(formData, "autoscaleEnabled"),
			autoscaleMemoryThresholdPercent: Number.isFinite(memThreshold)
				? Math.min(99, Math.max(1, memThreshold))
				: 80,
			autoscaleOverflowRemoteHostId: overflowRemoteHostId,
		});
		logger.info(`Autoscale settings updated: user=${locals.user.id}`);
		return { savedSection: "autoscale", success: true };
	},

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
		return { savedSection: "orchestration", success: true };
	},
};
