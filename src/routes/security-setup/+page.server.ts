import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { safeNextPath } from "$lib/security-policy";
import { AccountSecurityService } from "$lib/services/account-security.service";

export const load = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}

	const next = safeNextPath(url.searchParams.get("next"));
	const settings = await InstanceSettingsDTO.get();
	const policy = settings.securityPolicy;
	const unmet = await AccountSecurityService.unmetRequirements(
		locals.user.id,
		policy,
	);
	if (unmet.length === 0) {
		throw redirect(302, next);
	}

	const [hasPassword, passkeys] = await Promise.all([
		AccountSecurityService.hasPassword(locals.user.id),
		AccountSecurityService.listPasskeys(locals.user.id),
	]);

	return {
		email: locals.user.email,
		hasPassword,
		passkeys,
		policy,
		unmet,
	};
};
