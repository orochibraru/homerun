import { ActivityFeed } from "#lib/server/activity-feed.js";

export const GET = ({ locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}
	return new Response(ActivityFeed.stream(), {
		headers: {
			"Cache-Control": "no-store",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
			"X-Accel-Buffering": "no",
		},
	});
};
