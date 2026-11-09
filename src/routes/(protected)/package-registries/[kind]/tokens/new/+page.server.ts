import { fail } from "@sveltejs/kit";

import {
	isPackageRegistryKind,
	packageRegistryUsage,
} from "#lib/package-registries.js";
import { highlightCode } from "#lib/server/shiki.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { PackageRegistryService } from "#lib/services/package-registry.service.js";

export const actions = {
	create: async ({ locals, params, request }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		if (!isPackageRegistryKind(params.kind)) {
			return fail(404, { error: "There's no such package registry." });
		}
		const username = String((await request.formData()).get("username") ?? "")
			.trim()
			.toLowerCase();
		try {
			const created = await PackageRegistryService.createToken(
				params.kind,
				username,
				locals.user.id,
			);
			const status = await PackageRegistryService.status(params.kind);
			const snippets = await Promise.all(
				packageRegistryUsage(params.kind, status.usageUrl, {
					secret: created.secret,
					username: created.username,
				}).map(async (snippet) => ({
					...snippet,
					html: await highlightCode(snippet.code, snippet.language),
				})),
			);
			return { created, snippets, success: true };
		} catch (error) {
			return fail(400, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
};
