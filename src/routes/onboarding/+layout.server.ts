import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { hasAnyUser } from "$lib/server/onboarding";

export const load = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(
			302,
			resolve((await hasAnyUser()) ? "/auth/sign-in" : "/auth/sign-up"),
		);
	}

	const settings = await InstanceSettingsDTO.get();
	const onboardingDone = settings.onboardingComplete;

	if (onboardingDone) {
		throw redirect(302, resolve("/"));
	}

	return {
		onboardingDone,
		user: locals.user,
	};
};
