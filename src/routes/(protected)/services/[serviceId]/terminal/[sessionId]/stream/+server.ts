import { subscribeToSession } from "$lib/server/docker/terminal";

export const GET = ({ params, locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}
	const userId = locals.user.id;

	let unsubscribe: (() => void) | null = null;

	const stream = new ReadableStream<Uint8Array>({
		cancel() {
			unsubscribe?.();
		},
		start(controller) {
			unsubscribe = subscribeToSession(params.sessionId, userId, (chunk) => {
				try {
					controller.enqueue(chunk);
				} catch {
					// Controller already closed (client disconnected) — the
					// cancel() callback will unsubscribe.
				}
			});
			if (!unsubscribe) {
				controller.error(new Error("Session not found"));
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
