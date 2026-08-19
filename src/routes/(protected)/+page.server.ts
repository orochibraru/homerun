import { desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { deployment, service } from "$lib/server/db/schema";

export const load = async ({ parent }) => {
	// (protected)/+layout.server.ts already redirects unauthenticated users
	// before this load runs — parent() gives the already-guaranteed user.
	const { user } = await parent();

	const [services, recentDeployments] = await Promise.all([
		db.select().from(service).where(eq(service.userId, user.id)),
		db
			.select({
				deployment,
				serviceName: service.name,
				serviceSlug: service.slug,
			})
			.from(deployment)
			.leftJoin(service, eq(deployment.serviceId, service.id))
			.where(eq(deployment.userId, user.id))
			.orderBy(desc(deployment.createdAt))
			.limit(5),
	]);

	return {
		stats: {
			totalServices: services.length,
			running: services.filter((s) => s.currentStatus === "running").length,
		},
		recentDeployments: recentDeployments.map((r) => ({
			...r.deployment,
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		})),
	};
};
