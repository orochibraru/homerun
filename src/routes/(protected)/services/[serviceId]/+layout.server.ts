import { error, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { syncServiceStatus } from "$lib/server/docker/reconcile";
import { ownedService } from "$lib/server/services";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(302, resolve("/auth/sign-in"));

	const row = await ownedService(params.serviceId, locals.user.id);
	if (!row) error(404, "Service not found");

	if (row.containerId) {
		await syncServiceStatus(row.id);
		const fresh = await ownedService(params.serviceId, locals.user.id);
		return { service: fresh ?? row, baseDomain: config.baseDomain };
	}

	return { service: row, baseDomain: config.baseDomain };
};
