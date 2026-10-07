import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { requirePermission, requireUser } from "#lib/server/remote-auth.js";
import { AdminService, type SetupCheck } from "#lib/services/admin.service.js";
import { traefikExpectation } from "#lib/services/cron/core-services-watch.js";
import type { InfraContainer } from "#lib/services/docker/core-services.js";
import type { SwarmReadiness } from "#lib/services/docker/swarm.js";
import { DockerService } from "#lib/services/docker.service.js";
import { command, query } from "$app/server";

export interface SetupStatus {
	checks: SetupCheck[];
	fieldsByCheck: Record<string, string[]>;
	issuesByField: Record<string, string>;
}

export const getSetupStatus = query(async (): Promise<SetupStatus> => {
	requireUser();
	const checks = await AdminService.runSetupChecks();
	const issues = checks.filter((check) => check.severity !== "ok");

	const issuesByField: Record<string, string> = {};
	for (const check of issues) {
		for (const field of AdminService.SETUP_CHECK_FIELDS[check.id] ?? []) {
			issuesByField[field] = check.detail;
		}
	}

	return {
		checks,
		fieldsByCheck: AdminService.SETUP_CHECK_FIELDS,
		issuesByField,
	};
});

export const getNewtContainer = query(
	async (): Promise<InfraContainer | null> => {
		requireUser();
		return await DockerService.findNewtContainer();
	},
);

/** Whether this host could actually run swarm-mode services today : checked live, so onboarding and Settings can say what's missing instead of the admin finding out on first deploy. */
export const getSwarmReadiness = query(async (): Promise<SwarmReadiness> => {
	requireUser();
	return await DockerService.swarmReadiness();
});

/**
 * Puts the Traefik flags the settings call for back onto the running
 * container, the setup check's one-click fix. Admin-only: it recreates
 * Traefik, which cuts every route for a few seconds.
 *
 * @throws Error naming each step that failed.
 */
export const reapplyTraefikConfig = command(async (): Promise<void> => {
	requirePermission("settings", "write");
	const settings = await InstanceSettingsDTO.get();
	const failures = await DockerService.reassertTraefikConfig(
		traefikExpectation(settings.orchestrationMode === "swarm"),
	);
	if (failures.length > 0) {
		throw new Error(failures.join("; "));
	}
	await getSetupStatus().refresh();
});
