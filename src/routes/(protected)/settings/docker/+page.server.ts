import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import {
	applyAndRebuild,
	nullableText,
} from "$lib/server/validation/instance-settings-form";

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
