import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { AdminService } from "$lib/services/admin.service";

export const load = async () => {
	// Public self-service sign-up only exists to create the instance's first
	// (admin) account — see hooks.server.ts's hard block on the underlying
	// endpoint. Once that account exists, this page just bounces to sign-in;
	// every later account comes from the admin-only Users page instead.
	if (await AdminService.hasAnyUser()) {
		throw redirect(302, resolve("/auth/sign-in"));
	}
};
