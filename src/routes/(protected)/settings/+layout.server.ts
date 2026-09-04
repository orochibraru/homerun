import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { envDefaultsForDisplay } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { AdminService } from "$lib/services/admin.service";

const FIELD_TAB: Record<string, string> = {
	authCheckUrl: "",
	authCrossSubdomainCookies: "",
	baseDomain: "",
	dockerNetworkName: "docker",
	dockerSocketPath: "docker",
	smtpFrom: "email",
	smtpHost: "email",
	smtpPassword: "email",
	smtpPort: "email",
	smtpUser: "email",
};

export const load = async ({ locals, url }) => {
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}

	const highlightParam = url.searchParams.get("highlight") ?? "";
	const highlightFields = highlightParam.split(",").filter(Boolean);
	const targetTab =
		highlightFields.length > 0 ? FIELD_TAB[highlightFields[0]] : undefined;
	if (targetTab && url.pathname === resolve("/settings")) {
		throw redirect(
			303,
			`${resolve("/settings")}/${targetTab}?highlight=${highlightParam}`,
		);
	}

	const [settings, remoteHosts, setupChecks] = await Promise.all([
		InstanceSettingsDTO.get(),
		RemoteHostDTO.listDeployTargets(locals.user.id),
		AdminService.runSetupChecks(),
	]);

	const fieldIssues: Record<string, string> = {};
	for (const check of setupChecks) {
		if (check.severity === "ok") {
			continue;
		}
		for (const field of AdminService.SETUP_CHECK_FIELDS[check.id] ?? []) {
			fieldIssues[field] = check.detail;
		}
	}

	return {
		envDefaults: envDefaultsForDisplay(),
		fieldIssues,
		remoteHosts: remoteHosts.map((h) => h.toJSON()),
		settings: settings.toJSON(),
	};
};
