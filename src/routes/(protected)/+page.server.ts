import { redirect } from "@sveltejs/kit";
import { desc, eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { deployment, service } from "$lib/server/db/schema";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, resolve("/auth/sign-in"));

	const [services, recentDeployments] = await Promise.all([
		db.select().from(service).where(eq(service.userId, locals.user.id)),
		db
			.select({
				deployment,
				serviceName: service.name,
				serviceSlug: service.slug,
			})
			.from(deployment)
			.leftJoin(service, eq(deployment.serviceId, service.id))
			.where(eq(deployment.userId, locals.user.id))
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
