import { fail } from "@sveltejs/kit";

import { isPackageRegistryKind } from "#lib/package-registries.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { PackageRegistryService } from "#lib/services/package-registry.service.js";

export const load = async ({ parent }) => {
	const { kind } = await parent();
	const tokens = await PackageRegistryService.listTokens(kind);
	return { tokens: tokens.map((token) => token.toJSON()) };
};

export const actions = {
	revoke: async ({ locals, params, request }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		if (!isPackageRegistryKind(params.kind)) {
			return fail(404, { error: "There's no such package registry." });
		}
		const id = String((await request.formData()).get("id") ?? "");
		try {
			await PackageRegistryService.revokeToken(params.kind, id);
			return { success: true };
		} catch (error) {
			return fail(400, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
};
