import {
	type AnalyticsRange,
	isAnalyticsRange,
	isTimeZone,
} from "$lib/analytics-ranges";
import { AnalyticsService } from "$lib/services/analytics.service";

export const load = async ({ cookies, params, url }) => {
	const requested = url.searchParams.get("range");
	const range: AnalyticsRange = isAnalyticsRange(requested)
		? requested
		: "week";
	const cookieZone = cookies.get("tz") ?? "";
	const zone = isTimeZone(cookieZone) ? cookieZone : "UTC";
	return {
		analytics: await AnalyticsService.forService(params.serviceId, range, zone),
		zone,
	};
};
