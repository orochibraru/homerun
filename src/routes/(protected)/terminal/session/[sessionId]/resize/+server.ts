import { z } from "zod";
import { DockerService } from "#lib/services/docker.service.js";

const sizeSchema = z.object({
	cols: z.int().min(1).max(1000),
	rows: z.int().min(1).max(1000),
});

export const POST = async ({ params, request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const size = sizeSchema.safeParse(await request.json().catch(() => null));
	if (!size.success) {
		return Response.json({ error: "Invalid size" }, { status: 400 });
	}
	const ok = await DockerService.resizeSession(
		params.sessionId,
		locals.user.id,
		size.data,
	);
	if (!ok) {
		return Response.json({ error: "Session not found" }, { status: 404 });
	}
	return Response.json({ success: true });
};
