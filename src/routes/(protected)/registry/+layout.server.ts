import { redirect } from "@sveltejs/kit";
import { RegistryService } from "#lib/services/registry.service.js";
import { resolve } from "$app/paths";

export const load = async ({ parent }) => {
	const { user } = await parent();
	if (user.role !== "admin") {
		throw redirect(302, resolve(""));
	}
	return { status: await RegistryService.status() };
};
