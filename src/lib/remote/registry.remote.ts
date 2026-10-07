import type { RegistryCheck } from "#lib/registry-self-test.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import { RegistryService } from "#lib/services/registry.service.js";
import { command } from "$app/server";

export const testRegistry = command(async (): Promise<RegistryCheck[]> => {
	requirePermission("registry", "write");
	return await RegistryService.selfTest();
});
