import { RegistryService } from "#lib/services/registry.service.js";

export const load = async ({ parent }) => {
	await parent();
	return { status: await RegistryService.status() };
};
