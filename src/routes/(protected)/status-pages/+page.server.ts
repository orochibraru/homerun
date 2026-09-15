import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { NotificationChannelDTO } from "$lib/dto/notification-channel-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { Logger } from "$lib/logger";
import {
	notificationChannelSchema,
	validateChannelTarget,
} from "$lib/server/validation/status-page";
import { StatusAlertService } from "$lib/services/status-alert.service";

const logger = new Logger("StatusPages");

export const load = async ({ parent }) => {
	const { user } = await parent();

	const [pages, channels, services, latest] = await Promise.all([
		StatusPageDTO.list(user.id),
		NotificationChannelDTO.list(user.id),
		ServiceDTO.list(user.id),
		UptimeCheckDTO.latestForUser(user.id),
	]);

	const health = new Map<string, boolean>();
	for (const check of latest) {
		health.set(
			check.serviceId,
			(health.get(check.serviceId) ?? true) && check.ok,
		);
	}

	const covered = await Promise.all(
		pages.map(async (page) => ({
			page: page.toJSON(),
			serviceIds: await page.serviceIds(),
		})),
	);

	return {
		channels: channels.map((channel) => channel.toJSON()),
		pages: covered.map(({ page, serviceIds }) => ({
			...page,
			serviceCount: serviceIds.length,
			downCount: serviceIds.filter((id) => health.get(id) === false).length,
		})),
		probedServiceIds: [...health.keys()],
		services: services.map((svc) => ({
			health:
				health.get(svc.id) === undefined
					? ("unknown" as const)
					: health.get(svc.id)
						? ("up" as const)
						: ("down" as const),
			id: svc.id,
			name: svc.name,
			projectId: svc.projectId,
			slug: svc.slug,
		})),
	};
};

export const actions = {
	createChannel: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const form = await request.formData();
		const parsed = notificationChannelSchema.safeParse(
			Object.fromEntries(form),
		);
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

		await NotificationChannelDTO.create({
			enabled: parsed.data.enabled,
			kind: parsed.data.kind,
			name: parsed.data.name,
			statusPageId: parsed.data.statusPageId || null,
			target: parsed.data.target,
			userId: locals.user.id,
		});
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
			await StatusAlertService.sendTest(channel);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`Test alert failed: channel=${id} : ${message}`);
			return fail(502, { error: `Couldn't send the test alert : ${message}` });
		}
		return { success: true };
	},
};
