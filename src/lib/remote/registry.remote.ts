import { command } from "$app/server";
import type { RegistryCheck } from "$lib/registry-self-test";
import { requireAdmin } from "$lib/server/remote-auth";
import { RegistryService } from "$lib/services/registry.service";

export const testRegistry = command(async (): Promise<RegistryCheck[]> => {
	requireAdmin();
	return await RegistryService.selfTest();
});
