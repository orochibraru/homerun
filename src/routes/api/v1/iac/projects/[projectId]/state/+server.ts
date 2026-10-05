import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const GET = async ({ locals, params }) => {
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
	const body = await IacStateService.read(project);
	return body === null
		? new Response(null, { status: 204 })
		: new Response(body, {
				headers: { "content-type": "application/json" },
			});
};

export const POST = async ({ locals, params, request, url }) => {
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
	const result = await IacStateService.write(project, await request.text(), {
		lockId: url.searchParams.get("ID"),
		userId: locals.user.id,
	}).catch((err: unknown) =>
		err instanceof Error ? err : new Error(String(err)),
	);
	if (result instanceof Error) {
		return Response.json({ error: result.message }, { status: 400 });
	}
	if (!result.ok) {
		return Response.json(
			result.lock?.info ?? { error: "The state is locked." },
			{
				status: 409,
			},
		);
	}
	return Response.json({ serial: result.version.serial, success: true });
};
