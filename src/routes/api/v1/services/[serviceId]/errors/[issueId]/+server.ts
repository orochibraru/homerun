import { ErrorEventDTO } from "#lib/dto/error-event-dto.js";
import { ErrorIssueDTO } from "#lib/dto/error-issue-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { frameLinks } from "#lib/error-tracking/frame-links.js";
import { Logger } from "#lib/logger.js";
import { errorIssueStatusApiBody } from "#lib/server/validation/api.js";
import { ErrorTrackingService } from "#lib/services/error-tracking.service.js";

const logger = new Logger("ErrorTracking");

async function findIssue(serviceId: string, issueId: string) {
	const svc = await ServiceDTO.get(serviceId);
	const issue = svc ? await ErrorIssueDTO.getForService(svc.id, issueId) : null;
	return svc && issue ? { issue, svc } : null;
}

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const found = await findIssue(params.serviceId, params.issueId);
	if (!found) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const { issue, svc } = found;
	const event = await ErrorEventDTO.getForIssue(
		issue.id,
		url.searchParams.get("event"),
	);
	const row = event?.toJSON() ?? null;
	const [neighbours, usersAffected, source] = await Promise.all([
		event?.neighbours() ?? null,
		issue.usersAffected(),
		row ? ErrorTrackingService.sourceRepo(svc.toJSON(), row.payload) : null,
	]);
	return Response.json({
		...issue.toJSON(),
		event: row
			? {
					...row.payload,
					id: row.id,
					newerEventId: neighbours?.newer ?? null,
					olderEventId: neighbours?.older ?? null,
					receivedAt: row.receivedAt,
					sourceLinks: frameLinks(row.payload, source),
				}
			: null,
		eventsRetained: neighbours?.total ?? 0,
		usersAffected,
	});
};

export const PATCH = async ({ params, locals, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const found = await findIssue(params.serviceId, params.issueId);
	if (!found) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const result = errorIssueStatusApiBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!result.success) {
		return Response.json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	await ErrorIssueDTO.setStatus(
		found.svc.id,
		[found.issue.id],
		result.data.status,
	);
	logger.info(
		`Error issue marked ${result.data.status} via API: service=${found.svc.id} issue=${found.issue.id} user=${locals.user.id}`,
	);
	const updated = await ErrorIssueDTO.getForService(
		found.svc.id,
		found.issue.id,
	);
	return Response.json(updated?.toJSON() ?? null);
};
