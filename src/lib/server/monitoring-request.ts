import type { Cookies } from "@sveltejs/kit";
import {
	isMonitoringRange,
	isTimeZone,
	type MonitoringRange,
} from "$lib/monitoring-ranges";

/** The range an monitoring page asks for (`?range=`, a week by default) and the viewer's time zone from the `tz` cookie (UTC until the page has set it). */
export function monitoringRequest(
	url: URL,
	cookies: Pick<Cookies, "get">,
): { range: MonitoringRange; zone: string } {
	const requested = url.searchParams.get("range");
	const cookieZone = cookies.get("tz") ?? "";
	return {
		range: isMonitoringRange(requested) ? requested : "week",
		zone: isTimeZone(cookieZone) ? cookieZone : "UTC",
	};
}
