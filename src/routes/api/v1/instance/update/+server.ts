import { Logger } from "#lib/logger.js";
import { startUpdateApiBody } from "#lib/server/validation/api.js";
import { SelfUpdateService } from "#lib/services/self-update.service.js";

const logger = new Logger("API");

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}
	const [release, preflight] = await Promise.all([
		SelfUpdateService.releaseStatus(),
		SelfUpdateService.preflight(),
	]);
	return Response.json({ ...release, preflight });
};

export const POST = async ({ locals, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}
	const raw = await request.text();
	let parsed: unknown = {};
	if (raw.trim()) {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return Response.json(
				{ error: "The body isn't valid JSON." },
				{ status: 400 },
			);
		}
	}
	const body = startUpdateApiBody.safeParse(parsed);
	if (!body.success) {
		return Response.json(
			{ error: "Invalid request body", issues: body.error.flatten() },
			{ status: 400 },
		);
	}
	const force = body.data.force === true;
	try {
		const result = await SelfUpdateService.start({ force });
		logger.info(
			`Self-update started via API: version=${result.version} user=${locals.user.id}${force ? " force" : ""}`,
		);
		return Response.json(result, { status: 202 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn(`Self-update via API refused: ${message}`);
		return Response.json({ error: message }, { status: 409 });
	}
};
