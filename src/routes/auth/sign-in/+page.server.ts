import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { AdminService } from "$lib/services/admin.service";

export const load = async () => {
	const hasUsers = await AdminService.hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("/auth/sign-up"));
	}
	return {
		oauthProviders: config.auth.oauthProviders
			.filter((p) => p.enabled)
			.map((p) => p.name),
	};
};
