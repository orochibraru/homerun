import { NotificationChannelDTO } from "#lib/dto/notification-channel-dto.js";
import { isNotificationEvent } from "#lib/notification-events.js";
import { notificationChannelApiJson } from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateNotificationChannelApiBody } from "#lib/server/validation/api-resources.js";
import { validateChannelTarget } from "#lib/server/validation/notification-channel.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const channel = await NotificationChannelDTO.get(
		params.channelId,
		caller.userId,
	);
	return channel
		? Response.json(notificationChannelApiJson(channel.toJSON()))
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const channel = await NotificationChannelDTO.get(
		params.channelId,
		caller.userId,
	);
	if (!channel) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateNotificationChannelApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { events, target, ...fields } = body.data;
	const targetError = target
		? validateChannelTarget(channel.kind, target)
		: null;
	if (targetError) {
		return apiError(targetError);
	}
	const patch = {
		...fields,
		...(target ? { lastError: null, target } : {}),
		...(events ? { events: events.filter(isNotificationEvent) } : {}),
	};
	if (Object.keys(patch).length > 0) {
		await channel.update(patch);
	}
	return Response.json(notificationChannelApiJson(channel.toJSON()));
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const channel = await NotificationChannelDTO.get(
		params.channelId,
		caller.userId,
	);
	if (!channel) {
		return apiError("Not found", 404);
	}
	await channel.delete();
	return new Response(null, { status: 204 });
};
