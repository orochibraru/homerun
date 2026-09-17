import { ServiceDTO } from "$lib/dto/service-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { UptimeCheckDTO } from "$lib/dto/uptime-check-dto";

export const load = async ({ parent }) => {
	await parent();

	const [pages, services, latest] = await Promise.all([
		StatusPageDTO.list(),
		ServiceDTO.list(),
		UptimeCheckDTO.latest(),
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
			stackId: svc.stackId,
			slug: svc.slug,
		})),
	};
};
