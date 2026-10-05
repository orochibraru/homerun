import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { parseLockInfo } from "#lib/iac-state.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const POST = async ({ locals, params, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return Response.json({ error: "Admins only." }, { status: 403 });
	}
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		return Response.json({ error: "Project not found." }, { status: 404 });
	}
	const info = parseLockInfo(await request.json().catch(() => null));
	if (!(info && typeof info.ID === "string")) {
		return Response.json(
			{ error: "The body is Terraform's lock info, with its ID." },
			{ status: 400 },
		);
	}
	const result = await IacStateService.lock(project, info, locals.user.id);
	return result.ok
		? Response.json(result.lock.info ?? info)
		: Response.json(result.lock.info ?? { ID: result.lock.lockId }, {
				status: 423,
			});
};

export const DELETE = async ({ locals, params, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return Response.json({ error: "Admins only." }, { status: 403 });
	}
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		return Response.json({ error: "Project not found." }, { status: 404 });
	}
	const info = parseLockInfo(await request.json().catch(() => null));
	const held = await IacStateService.unlock(
		project,
		typeof info?.ID === "string" ? info.ID : null,
	);
	return held
		? Response.json(held.info ?? { ID: held.lockId }, { status: 423 })
		: Response.json({ success: true });
};
