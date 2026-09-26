import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { RevisionService } from "$lib/services/revision.service";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const revisions = await RevisionService.list(svc);
	return json(
		revisions.map((revision) => ({
			buildSource: revision.buildSource,
			createdAt: revision.createdAt,
			current: revision.current,
			environment: revision.environment,
			gitCommit: revision.gitCommit,
			gitRef: revision.gitRef,
			health: revision.health,
			healthReason: revision.healthReason,
			id: revision.id,
			imageDigest: revision.imageDigest,
			imageId: revision.imageId,
			imageRef: revision.imageRef,
			lastDeployedAt: revision.lastDeployedAt,
			latestDeploymentId: revision.latestDeploymentId,
			previous: revision.previous,
			redeployCount: revision.redeployCount,
			retained: revision.retained,
			status: revision.status,
		})),
	);
};
