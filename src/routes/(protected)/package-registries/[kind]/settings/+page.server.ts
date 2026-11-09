import { fail } from "@sveltejs/kit";

import { config } from "#lib/config.js";
import {
	isPackageRegistryKind,
	PACKAGE_REGISTRY_INFO,
} from "#lib/package-registries.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { PackageRegistryService } from "#lib/services/package-registry.service.js";

export const load = async ({ parent }) => {
	const { kind } = await parent();
	const prefix = PACKAGE_REGISTRY_INFO[kind].hostPrefix;
	return {
		suggestedHost: config.baseDomain ? `${prefix}.${config.baseDomain}` : "",
	};
};

export const actions = {
	save: async ({ locals, params, request }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		if (!isPackageRegistryKind(params.kind)) {
			return fail(404, { error: "There's no such package registry." });
		}
		const formData = await request.formData();
		const enabled = formData.get("enabled") === "on";
		const host = String(formData.get("publicHost") ?? "");
		const problem = await PackageRegistryService.publicHostProblem(
			params.kind,
			host,
		);
		if (problem) {
			return fail(400, { error: problem });
		}
		const job = await enqueueCoreServiceJob(
			{ action: "configurePackageRegistry", enabled, host, kind: params.kind },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},
};
