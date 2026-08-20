import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { AdminService } from "$lib/services/admin.service";

export const load = async () => {
	const hasUsers = await AdminService.hasAnyUser();
	if (!hasUsers) {
		throw redirect(302, resolve("/auth/sign-up"));
	}
};
