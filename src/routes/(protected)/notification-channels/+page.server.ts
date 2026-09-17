import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { NotificationChannelDTO } from "$lib/dto/notification-channel-dto";
import { Logger } from "$lib/logger";
import { channelTargetLabel } from "$lib/notification-channel-target";
import {
	channelTargetFromForm,
	notificationChannelSchema,
	validateChannelTarget,
} from "$lib/server/validation/notification-channel";
import { NotificationChannelService } from "$lib/services/notification-channel.service";

const logger = new Logger("NotificationChannels");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const channels = await NotificationChannelDTO.list(user.id);
	return {
		channels: channels.map((channel) => ({
			...channel.toJSON(),
			target: channelTargetLabel(channel.kind, channel.target),
		})),
	};
};

export const actions = {
	createChannel: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const form = await request.formData();
		const parsed = notificationChannelSchema.safeParse({
			...Object.fromEntries(form),
			target: channelTargetFromForm(form),
		});
		if (!parsed.success) {
			return fail(400, { errors: parsed.error.flatten().fieldErrors });
		}
		const targetError = validateChannelTarget(
			parsed.data.kind,
			parsed.data.target,
		);
		if (targetError) {
			return fail(400, { errors: { target: [targetError] } });
		}

		const channel = await NotificationChannelDTO.create({
			kind: parsed.data.kind,
			name: parsed.data.name,
			target: parsed.data.target,
			userId: locals.user.id,
		});
		logger.info(
			`Notification channel created: channel=${channel.id} kind=${channel.kind} user=${locals.user.id}`,
		);
		return { success: true };
	},

	deleteChannel: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const form = await request.formData();
		const id = form.get("channelId");
		if (typeof id !== "string" || !id) {
			return fail(400, { error: "Missing channel id." });
		}
		const channel = await NotificationChannelDTO.get(id, locals.user.id);
		if (!channel) {
			return fail(404, { error: "Channel not found." });
		}
		await channel.delete();
		logger.info(
			`Notification channel deleted: channel=${id} user=${locals.user.id}`,
		);
		return { success: true };
	},

	testChannel: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const form = await request.formData();
		const id = form.get("channelId");
		if (typeof id !== "string" || !id) {
			return fail(400, { error: "Missing channel id." });
		}
		const channel = await NotificationChannelDTO.get(id, locals.user.id);
		if (!channel) {
			return fail(404, { error: "Channel not found." });
		}
		try {
			await NotificationChannelService.sendTest(channel);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`Test notification failed: channel=${id} : ${message}`);
			await channel.update({ lastError: message });
			return fail(502, {
				error: `Couldn't send the test notification : ${message}`,
			});
		}
		return { success: true };
	},
};
