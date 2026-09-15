import { query } from "$app/server";
import { requireUser } from "$lib/server/remote-auth";
import { AdminService, type SetupCheck } from "$lib/services/admin.service";
import type { InfraContainer } from "$lib/services/docker/core-services";
import { DockerService } from "$lib/services/docker.service";

export interface SetupStatus {
	checks: SetupCheck[];
	highlightFields: string[];
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
		highlightFields: [
			...new Set(
				issues.flatMap(
					(check) => AdminService.SETUP_CHECK_FIELDS[check.id] ?? [],
				),
			),
		],
		issuesByField,
	};
});

export const getNewtContainer = query(
	async (): Promise<InfraContainer | null> => {
		requireUser();
		return await DockerService.findNewtContainer();
	},
);
