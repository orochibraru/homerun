import { error } from "@sveltejs/kit";

import { isPackageRegistryKind } from "#lib/package-registries.js";
import { PackageRegistryService } from "#lib/services/package-registry.service.js";

export const load = async ({ params, parent }) => {
	await parent();
	if (!isPackageRegistryKind(params.kind)) {
		error(404, "There's no such package registry.");
	}
	return {
		kind: params.kind,
		status: await PackageRegistryService.status(params.kind),
	};
};
