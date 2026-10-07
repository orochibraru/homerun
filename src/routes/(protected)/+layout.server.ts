import { error, redirect } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { UserPreferencesDTO } from "#lib/dto/user-preferences-dto.js";
import {
	can,
	hasAllPermissions,
	hasAnyWrite,
	permissionDeniedMessage,
	requiredPermission,
} from "#lib/permissions.js";
import { AccountSecurityService } from "#lib/services/account-security.service.js";
import { AdminService } from "#lib/services/admin.service.js";
import { effectiveSurface } from "#lib/surfaces.js";
import { DEFAULT_UI_MODE, effectiveUiMode } from "#lib/ui-mode.js";
import { resolve } from "$app/paths";

export const load = async ({ locals, route, url }) => {
	if (!locals.user) {
		throw redirect(
			302,
			resolve(
				(await AdminService.hasAnyUser()) ? "/auth/sign-in" : "/auth/sign-up",
			),
		);
	}

	if (locals.appOnly) {
		throw redirect(302, resolve("my-apps"));
	}

	const required = requiredPermission("GET", route.id);
	if (required === "unmapped" && !hasAllPermissions(locals.permissions)) {
		error(403, "Admins only.");
	}
	if (
		required &&
		required !== "unmapped" &&
		!can(locals.permissions, required.area, required.level)
	) {
		error(403, permissionDeniedMessage(required.area, required.level));
	}

	const settings = await InstanceSettingsDTO.get();
	const onboardingDone = settings.onboardingComplete;

	if (!onboardingDone) {
		throw redirect(302, resolve("onboarding"));
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
				`${resolve("security-setup")}?next=${encodeURIComponent(currentPath)}`,
			);
		}
	}

	// Fetched here (the one load every protected page shares) so the
	// sidebar's own color/accent styling (see (protected)/+layout.svelte)
	// has what it needs without every page needing its own fetch. The
	// notification feed itself is a remote query the bell owns, see
	// $lib/remote/notifications.remote.ts.
	const preferences = await UserPreferencesDTO.get(locals.user.id);
	locals.surface = effectiveSurface(preferences.toJSON());

	return {
		onboardingDone,
		preferences: preferences.toJSON(),
		instanceUiMode: settings.toJSON().defaultUiMode ?? DEFAULT_UI_MODE,
		permissions: locals.permissions,
		readOnly: !hasAnyWrite(locals.permissions),
		uiMode: effectiveUiMode(
			preferences.toJSON().uiMode,
			settings.toJSON().defaultUiMode,
		),
		user: locals.user,
	};
};
