import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
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
	// icon in the sidebar layout has its feed/count without every page
	// needing its own fetch.
	const [notifications, unreadCount] = await Promise.all([
		NotificationDTO.listForUser(locals.user.id, 20),
		NotificationDTO.unreadCount(locals.user.id),
	]);

	return {
		notifications: notifications.map((n) => ({
			...n.notification.toJSON(),
			serviceSlug: n.serviceSlug,
		})),
		onboardingDone,
		unreadCount,
		user: locals.user,
	};
};
