import { error } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { BEAT_WINDOW, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";

export const load = async ({ params }) => {
	const page = await StatusPageDTO.getPublicBySlug(params.slug);
	if (!page) {
		error(404, "No status page here");
	}

	const memberIds = await page.serviceIds();
	const owned = await ServiceDTO.list(page.userId);
	const members = owned.filter((svc) => memberIds.includes(svc.id));

	const services = await Promise.all(
		members.map(async (svc) => {
			const beats = await UptimeCheckDTO.beats(svc.id, "internal");
			const recent = beats.slice(-BEAT_WINDOW);
			const okCount = recent.filter((beat) => beat.ok).length;
			return {
				beats: recent.map((beat) => ({
					checkedAt: beat.checkedAt,
					ok: beat.ok,
				})),
				id: svc.id,
				name: svc.name,
				status:
					recent.length === 0
						? ("unknown" as const)
						: recent[recent.length - 1].ok
							? ("up" as const)
							: ("down" as const),
				uptimePercent:
					recent.length === 0
						? null
						: Math.round((okCount / recent.length) * 1000) / 10,
			};
		}),
	);

	return {
		description: page.toJSON().description,
		name: page.name,
		services,
		updatedAt: new Date(),
	};
};
