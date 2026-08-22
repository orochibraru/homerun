import { json } from "@sveltejs/kit";
import { NotificationDTO } from "$lib/dto/notification-dto";

export const POST = async ({ locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}
	await NotificationDTO.markAllRead(locals.user.id);
	return json({ success: true });
};
