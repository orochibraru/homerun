import { ServiceDTO } from "#lib/dto/service-dto.js";
import { TemplateDTO } from "#lib/dto/template-dto.js";
import { UptimeCheckDTO } from "#lib/dto/uptime-check-dto.js";
import { can } from "#lib/permissions.js";
import { describeReading } from "#lib/resource-thresholds.js";
import { monitoringRequest } from "#lib/server/monitoring-request.js";
import { CapacityService } from "#lib/services/capacity.service.js";
import { MonitoringService } from "#lib/services/monitoring.service.js";
import { isProbed } from "#lib/services/uptime/uptime-probe.js";
import { SIMPLE_FRONT_PAGE_TEMPLATES } from "#lib/ui-mode.js";

/** The front page's one-click templates, in `SIMPLE_FRONT_PAGE_TEMPLATES` order, skipping any this instance doesn't have. */
async function frontPageTemplates() {
	const templates = new Map(
		(await TemplateDTO.list()).map((tmpl) => [tmpl.id, tmpl.toJSON()]),
	);
	return SIMPLE_FRONT_PAGE_TEMPLATES.flatMap((id) => {
		const tmpl = templates.get(id);
		return tmpl
			? [
					{
						category: tmpl.category,
						description: tmpl.description,
						icon: tmpl.icon,
						id: tmpl.id,
						name: tmpl.name,
					},
				]
			: [];
	});
}

/** "Good morning", "Good afternoon" or "Good evening", by the hour in the viewer's time zone. */
function greeting(zone: string): string {
	const hour = Number(
		new Intl.DateTimeFormat("en-GB", {
			hour: "numeric",
			hourCycle: "h23",
			timeZone: zone,
		}).format(new Date()),
	);
	if (hour >= 5 && hour < 12) {
		return "Good morning";
	}
	return hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
}

/** One row per failing probe of a probed service, newest first : what's down, not a roll-call of what's fine. */
async function uptimeDown(pending: Promise<ServiceDTO[]>) {
	const [services, uptime] = await Promise.all([
		pending,
		UptimeCheckDTO.latest(),
	]);
	const serviceNames = new Map(services.map((svc) => [svc.id, svc.name]));
	const probed = new Set(
		services.filter((svc) => isProbed(svc.toJSON())).map((svc) => svc.id),
	);
	return uptime
		.filter((check) => probed.has(check.serviceId) && !check.ok)
		.map((check) => ({
			detail: check.detail,
			kind: check.kind,
			serviceId: check.serviceId,
			serviceName: serviceNames.get(check.serviceId) ?? "Unknown service",
			target: check.target,
		}));
}

/** Every service whose update check found a newer image, with how its trial run went, newest find first. */
async function availableUpdates(pending: Promise<ServiceDTO[]>) {
	const services = await pending;
	return services
		.flatMap((svc) => {
			const check = svc.toJSON().updateCheck;
			if (!check?.available) {
				return [];
			}
			return [
				{
					currentTag: svc.tag,
					foundAt: check.available.foundAt,
					serviceId: svc.id,
					serviceName: svc.name,
					tag: check.available.tag,
					trialAttempts: check.trial?.attempts ?? null,
					trialStatus: check.trial?.status ?? null,
				},
			];
		})
		.toSorted((a, b) => b.foundAt.localeCompare(a.foundAt));
}

export const load = async ({ cookies, locals, parent, url }) => {
	const { uiMode } = await parent();

	const readsServices = can(locals.permissions, "services");
	const services = readsServices
		? ServiceDTO.list()
		: Promise.resolve<ServiceDTO[]>([]);
	const zone = monitoringRequest(url, cookies).zone;

	return {
		availableUpdates: readsServices
			? availableUpdates(services)
			: Promise.resolve([]),
		frontPageTemplates:
			uiMode === "simple" && can(locals.permissions, "services", "write")
				? frontPageTemplates()
				: Promise.resolve([]),
		greeting: greeting(zone),
		monitoring: services.then((rows) =>
			MonitoringService.forScope(
				{ resources: "host", serviceIds: rows.map((svc) => svc.id) },
				"today",
				zone,
			),
		),
		overCapacity: CapacityService.hardBreaches().then((breaches) =>
			breaches.map(describeReading),
		),
		readsServices,
		readsSettings: can(locals.permissions, "settings"),
		serviceIcons: services.then((rows) =>
			Object.fromEntries(
				rows.map((svc) => [svc.id, { category: svc.category, icon: svc.icon }]),
			),
		),
		stats: services.then((rows) => ({
			running: rows.filter((s) => s.currentStatus === "running").length,
			totalServices: rows.length,
		})),
		uptimeDown: readsServices ? uptimeDown(services) : Promise.resolve([]),
	};
};
