import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { envDefaultsForDisplay } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";

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

	const settings = await InstanceSettingsDTO.get();

	return {
		envDefaults: envDefaultsForDisplay(),
		settings: settings.toJSON(),
	};
};
