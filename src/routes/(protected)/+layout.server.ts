import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { UserPreferencesDTO } from "$lib/dto/user-preferences-dto";
import { AccountSecurityService } from "$lib/services/account-security.service";
import { AdminService } from "$lib/services/admin.service";

export const load = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(
			302,
			resolve(
				(await AdminService.hasAnyUser()) ? "/auth/sign-in" : "/auth/sign-up",
			),
		);
	}

	const settings = await InstanceSettingsDTO.get();
	const onboardingDone = settings.onboardingComplete;

	if (!onboardingDone) {
		throw redirect(302, resolve("/onboarding"));
	}

	const currentPath = url.pathname;
	if (locals.session) {
		const unmet = await AccountSecurityService.unmetRequirements(
			locals.user.id,
			settings.securityPolicy,
		);
		if (unmet.length > 0) {
			throw redirect(
				302,
				`${resolve("/security-setup")}?next=${encodeURIComponent(currentPath)}`,
			);
		}
	}

	// Fetched here (the one load every protected page shares) so the
	// sidebar's own color/accent styling (see (protected)/+layout.svelte)
	// has what it needs without every page needing its own fetch. The
	// notification feed itself is a remote query the bell owns, see
	// $lib/remote/notifications.remote.ts.
	const preferences = await UserPreferencesDTO.get(locals.user.id);

	return {
		onboardingDone,
		preferences: preferences.toJSON(),
		readOnly: locals.readOnly,
		user: locals.user,
	};
};
