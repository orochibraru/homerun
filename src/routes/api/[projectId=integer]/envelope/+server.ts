import { ErrorTrackingService } from "$lib/services/error-tracking.service";

export const trailingSlash = "ignore";

export const OPTIONS = () => ErrorTrackingService.preflight();

export const POST = async ({ params, request, url }) =>
	await ErrorTrackingService.ingest(request, url, params.projectId, "envelope");
