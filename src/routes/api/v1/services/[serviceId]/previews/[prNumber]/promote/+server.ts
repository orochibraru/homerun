import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { promotePreviewApiBody } from "$lib/server/validation/api";
import { PreviewApiService } from "$lib/services/preview-api.service";

export const POST = async ({ params, locals, request }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const prNumber = Number(params.prNumber);
	if (!(Number.isInteger(prNumber) && prNumber > 0)) {
		return json({ error: "Not a pull request number." }, { status: 400 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const raw = await request.text();
	let body: unknown = {};
	if (raw.trim()) {
		try {
			body = JSON.parse(raw);
		} catch {
			return json({ error: "The body isn't valid JSON." }, { status: 400 });
		}
	}
	const parsed = promotePreviewApiBody.safeParse(body);
	if (!parsed.success) {
		return json(parsed.error.flatten(), { status: 400 });
	}
	const result = await PreviewApiService.promote({
		commit: parsed.data.commit ?? null,
		parent: svc,
		prNumber,
		userId: locals.user.id,
	});
	if (result.error !== null) {
		return json({ error: result.error }, { status: result.status });
	}
	return json(
		{
			deploymentId: result.deploymentId,
			gitCommit: result.revision.gitCommit,
			imageRef: result.revision.imageRef,
			jobId: result.jobId,
			previewId: result.preview.id,
			revisionId: result.revision.id,
		},
		{ status: 202 },
	);
};
