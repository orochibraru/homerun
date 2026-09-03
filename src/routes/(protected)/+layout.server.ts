import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
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

	// Fetched here (the one load every protected page shares) so the bell
	// icon and the sidebar's own color/accent styling (see (protected)/+layout.svelte)
	// have what they need without every page needing its own fetch.
	const [notifications, unreadCount, preferences] = await Promise.all([
		NotificationDTO.listForUser(locals.user.id, 20),
		NotificationDTO.unreadCount(locals.user.id),
		UserPreferencesDTO.get(locals.user.id),
	]);

	return {
		notifications: notifications.map((n) => ({
			...n.notification.toJSON(),
			serviceSlug: n.serviceSlug,
		})),
		onboardingDone,
		preferences: preferences.toJSON(),
		unreadCount,
		user: locals.user,
	};
};
