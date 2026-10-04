import { redirect } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { AdminService } from "#lib/services/admin.service.js";
import { resolve } from "$app/paths";

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

	if (onboardingDone) {
		throw redirect(302, resolve(""));
	}

	return {
		onboardingDone,
		user: locals.user,
	};
};
