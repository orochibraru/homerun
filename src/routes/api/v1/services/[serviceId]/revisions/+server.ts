import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { RevisionService } from "$lib/services/revision.service";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const revisions = await RevisionService.list(svc);
	return json(
		revisions.map((revision) => ({
			buildSource: revision.buildSource,
			createdAt: revision.createdAt,
			current: revision.current,
			finishedAt: revision.finishedAt,
			gitCommit: revision.gitCommit,
			gitRef: revision.gitRef,
			health: revision.health,
			id: revision.id,
			imageDigest: revision.imageDigest,
			imageId: revision.imageId,
			imageRef: revision.imageRef,
			previous: revision.previous,
			retained: revision.retained,
			rollbackOfDeploymentId: revision.rollbackOfDeploymentId,
			status: revision.status,
		})),
	);
};
