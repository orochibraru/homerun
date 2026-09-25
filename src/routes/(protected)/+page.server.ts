import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { AppLogDTO } from "$lib/dto/app-log-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { Logger } from "$lib/logger";
import { describeReading } from "$lib/resource-thresholds";
import { CapacityService } from "$lib/services/capacity.service";
import { isProbed } from "$lib/services/uptime/uptime-probe";

const logger = new Logger("Dashboard");

export const load = async ({ locals, parent }) => {
	// (protected)/+layout.server.ts already redirects unauthenticated users
	// before this load runs : parent() gives the already-guaranteed user.
	await parent();

	const [services, recentDeployments, uptime, hardBreaches] = await Promise.all(
		[
			ServiceDTO.list(),
			DeploymentDTO.listRecent(),
			UptimeCheckDTO.latest(),
			CapacityService.hardBreaches(),
		],
	);
	const recentErrors = locals.isAdmin
		? await AppLogDTO.listRecent(5)
		: await AppLogDTO.listRecentForServices(
				services.map((svc) => svc.id),
				5,
			);
	const serviceNames = new Map(services.map((svc) => [svc.id, svc.name]));
	const probed = new Set(
		services.filter((svc) => isProbed(svc.toJSON())).map((svc) => svc.id),
	);
	const live = uptime.filter((check) => probed.has(check.serviceId));

	return {
		isAdmin: locals.isAdmin,
		overCapacity: hardBreaches.map(describeReading),
		recentDeployments: recentDeployments.map((r) => ({
			...r.deployment.toJSON(),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		})),
		recentErrors: recentErrors.map((log) => {
			const row = log.toJSON();
			return {
				createdAt: row.createdAt,
				id: row.id,
				level: row.level,
				message: row.message,
				scope: row.scope,
				serviceId: row.serviceId,
				serviceName: row.serviceId
					? (serviceNames.get(row.serviceId) ?? null)
					: null,
			};
		}),
		stats: {
			running: services.filter((s) => s.currentStatus === "running").length,
			totalServices: services.length,
		},
		// One row per failing probe, newest first : the dashboard shows what's
		// down, not a roll-call of everything that's fine.
		uptimeDown: live
			.filter((check) => !check.ok)
			.map((check) => ({
				detail: check.detail,
				kind: check.kind,
				serviceId: check.serviceId,
				serviceName: serviceNames.get(check.serviceId) ?? "Unknown service",
				target: check.target,
			})),
		uptimeProbes: live.length,
	};
};

export const actions = {
	clearErrors: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (locals.isAdmin) {
			await AppLogDTO.clear();
		} else {
			const services = await ServiceDTO.list();
			await AppLogDTO.clear(services.map((svc) => svc.id));
		}
		logger.info(`Recent errors cleared: user=${locals.user.id}`);
		return { success: true };
	},
};
