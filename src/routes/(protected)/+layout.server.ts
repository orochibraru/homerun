import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { UserPreferencesDTO } from "$lib/dto/user-preferences-dto";
import { AdminService } from "$lib/services/admin.service";

export const load = async ({ locals }) => {
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

	// Fetched here (the one load every protected page shares) so the
	// sidebar's own color/accent styling (see (protected)/+layout.svelte)
	// has what it needs without every page needing its own fetch. The
	// notification feed itself is a remote query the bell owns, see
	// $lib/remote/notifications.remote.ts.
	const preferences = await UserPreferencesDTO.get(locals.user.id);

	return {
		onboardingDone,
		preferences: preferences.toJSON(),
		user: locals.user,
	};
};
