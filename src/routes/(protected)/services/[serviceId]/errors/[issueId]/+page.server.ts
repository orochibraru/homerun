import { error, fail, redirect } from "@sveltejs/kit";
import { ErrorEventDTO } from "#lib/dto/error-event-dto.js";
import { ErrorIssueDTO } from "#lib/dto/error-issue-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { frameLinks } from "#lib/error-tracking/frame-links.js";
import { Logger } from "#lib/logger.js";
import { issueStatusFormSchema } from "#lib/server/validation/error-tracking.js";
import { ErrorTrackingService } from "#lib/services/error-tracking.service.js";
import { resolve } from "$app/paths";

const logger = new Logger("ErrorTracking");

export const load = async ({ params, parent, url }) => {
	const { service } = await parent();
	const issue = await ErrorIssueDTO.getForService(service.id, params.issueId);
	if (!issue) {
		error(404, "Issue not found");
	}
	const event = await ErrorEventDTO.getForIssue(
		issue.id,
		url.searchParams.get("event"),
	);
	const payload = event?.toJSON().payload ?? null;
	const [neighbours, usersAffected, source] = await Promise.all([
		event?.neighbours() ?? null,
		issue.usersAffected(),
		payload ? ErrorTrackingService.sourceRepo(service, payload) : null,
	]);
	return {
		event: event ? { ...event.toJSON(), payload: undefined } : null,
		issue: issue.toJSON(),
		links: payload ? frameLinks(payload, source) : {},
		neighbours,
		payload,
		source,
		usersAffected,
	};
};

export const actions = {
	status: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const formData = await request.formData();
		const result = issueStatusFormSchema.safeParse({
			issueId: [params.issueId],
			status: formData.get("status"),
		});
		if (!result.success) {
			return fail(400, { errors: result.error.flatten().fieldErrors });
		}
		await ErrorIssueDTO.setStatus(
			svc.id,
			result.data.issueId,
			result.data.status,
		);
		logger.info(
			`Error issue marked ${result.data.status}: service=${svc.id} issue=${params.issueId} user=${locals.user.id}`,
		);
		return { status: result.data.status };
	},
};
