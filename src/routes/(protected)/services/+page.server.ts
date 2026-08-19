import { fail, redirect } from "@sveltejs/kit";
import { and, desc, eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { syncAllServiceStatuses } from "$lib/server/docker/reconcile";
import {
	removeContainer,
	restartContainer,
	startContainer,
	stopContainer,
} from "$lib/server/docker/service";
import type { Actions, PageServerLoad } from "./$types";

async function loadServices(userId: string) {
	const rows = await db
		.select()
		.from(service)
		.where(eq(service.userId, userId))
		.orderBy(desc(service.createdAt));

	await syncAllServiceStatuses(
		rows.filter((r) => r.containerId).map((r) => r.id),
	);

	if (rows.some((r) => r.containerId)) {
		return db
			.select()
			.from(service)
			.where(eq(service.userId, userId))
			.orderBy(desc(service.createdAt));
	}
	return rows;
}

/** Loads a service and confirms it belongs to `userId`, or returns null. */
async function ownedService(serviceId: string, userId: string) {
	const [row] = await db
		.select()
		.from(service)
		.where(and(eq(service.id, serviceId), eq(service.userId, userId)))
		.limit(1);
	return row ?? null;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}

	const services = await loadServices(locals.user.id);

	return {
		services,
		baseDomain: config.baseDomain,
	};
};

export const actions: Actions = {
	start: async ({ request, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) return fail(400, { error: "Missing service id." });

		const row = await ownedService(serviceId, locals.user.id);
		if (!row) return fail(404, { error: "Service not found." });
		if (!row.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		await startContainer(row.containerId);
		await db
			.update(service)
			.set({ desiredState: "running" })
			.where(eq(service.id, serviceId));
		return { success: true };
	},

	stop: async ({ request, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) return fail(400, { error: "Missing service id." });

		const row = await ownedService(serviceId, locals.user.id);
		if (!row) return fail(404, { error: "Service not found." });
		if (!row.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		await stopContainer(row.containerId);
		await db
			.update(service)
			.set({ desiredState: "stopped" })
			.where(eq(service.id, serviceId));
		return { success: true };
	},

	restart: async ({ request, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) return fail(400, { error: "Missing service id." });

		const row = await ownedService(serviceId, locals.user.id);
		if (!row) return fail(404, { error: "Service not found." });
		if (!row.containerId) {
			return fail(400, { error: "This service hasn't been deployed yet." });
		}

		await restartContainer(row.containerId);
		return { success: true };
	},

	delete: async ({ request, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const data = await request.formData();
		const serviceId = data.get("serviceId") as string | null;
		if (!serviceId) return fail(400, { error: "Missing service id." });

		const row = await ownedService(serviceId, locals.user.id);
		if (!row) return fail(404, { error: "Service not found." });

		if (row.containerId) {
			try {
				await removeContainer(row.containerId, { force: true });
			} catch {
				// Container may already be gone on the host — proceed with
				// deleting our record regardless.
			}
		}
		await db.delete(service).where(eq(service.id, serviceId));
		return { success: true };
	},
};
