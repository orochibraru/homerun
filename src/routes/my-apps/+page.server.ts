import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { APP_ONLY_HOME } from "$lib/permissions";
import { AccountSecurityService } from "$lib/services/account-security.service";
import { AppAccessService } from "$lib/services/app-access.service";

export const load = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}
	if (!locals.appOnly) {
		throw redirect(302, resolve("/"));
	}

	const userId = locals.user.id;
	if (locals.session) {
		const settings = await InstanceSettingsDTO.get();
		const unmet = await AccountSecurityService.unmetRequirements(
			userId,
			settings.securityPolicy,
		);
		if (unmet.length > 0) {
			throw redirect(
				302,
				`${resolve("/security-setup")}?next=${encodeURIComponent(APP_ONLY_HOME)}`,
			);
		}
	}

	const [apps, hasPassword, passkeys, security] = await Promise.all([
		AppAccessService.sharedApps(userId),
		AccountSecurityService.hasPassword(userId),
		AccountSecurityService.listPasskeys(userId),
		AccountSecurityService.state(userId),
	]);

	return {
		apps,
		email: locals.user.email,
		hasPassword,
		passkeys,
		twoFactorEnabled: security.twoFactorEnabled,
	};
};
