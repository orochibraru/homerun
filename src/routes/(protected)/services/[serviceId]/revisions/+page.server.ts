import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { RevisionService } from "$lib/services/revision.service";

const logger = new Logger("Revisions");

export const load = async ({ parent }) => {
	const { service } = await parent();
	return { revisions: await RevisionService.history(service) };
};

export const actions = {
	deployRevision: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const formData = await request.formData();
		const revisionId = String(formData.get("revisionId") ?? "");
		const target = await RevisionService.findTarget(svc, revisionId || null);
		if (target.error !== null) {
			return fail(target.status, { error: target.error });
		}
		const { deploymentId } = await RevisionService.enqueueRollback({
			restoreConfig: formData.get("restoreConfig") === "on",
			revision: target.revision,
			svc,
			userId: locals.user.id,
		});
		logger.info(
			`Revision deploy queued: service=${svc.id} revision=${target.revision.id} deployment=${deploymentId} restoreConfig=${formData.get("restoreConfig") === "on"} user=${locals.user.id}`,
		);
		return { deploymentId, success: true };
	},
};
