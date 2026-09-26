import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type ServiceDependency,
	serviceDependency,
} from "$lib/server/db/schema";
import { createsCycle } from "$lib/service-graph";
import { BaseDTO } from "./base-dto";

/** Wraps the `service_dependency` table: one service explicitly depending on another, independent of any env var. */
export class ServiceDependencyDTO extends BaseDTO<ServiceDependency> {
	/** Every recorded dependency, as each service's id mapped to the ids it depends on. */
	static async map(): Promise<Map<string, string[]>> {
		const rows = await db.select().from(serviceDependency);
		const deps = new Map<string, string[]>();
		for (const row of rows) {
			deps.set(row.serviceId, [
				...(deps.get(row.serviceId) ?? []),
				row.dependsOnId,
			]);
		}
		return deps;
	}

	/** The ids of the services `serviceId` depends on. */
	static async listForService(serviceId: string): Promise<string[]> {
		const rows = await db
			.select({ dependsOnId: serviceDependency.dependsOnId })
			.from(serviceDependency)
			.where(eq(serviceDependency.serviceId, serviceId));
		return rows.map((row) => row.dependsOnId);
	}

	/**
	 * Records that `serviceId` depends on `dependsOnId`. Idempotent: an
	 * existing row is returned as is.
	 *
	 * @throws When the two are the same service, or `dependsOnId` already
	 * depends on `serviceId` at any depth.
	 */
	static async add(
		serviceId: string,
		dependsOnId: string,
	): Promise<ServiceDependencyDTO> {
		const deps = await ServiceDependencyDTO.map();
		if ((deps.get(serviceId) ?? []).includes(dependsOnId)) {
			const [existing] = await db
				.select()
				.from(serviceDependency)
				.where(
					and(
						eq(serviceDependency.serviceId, serviceId),
						eq(serviceDependency.dependsOnId, dependsOnId),
					),
				);
			return new ServiceDependencyDTO(existing);
		}
		if (createsCycle(serviceId, dependsOnId, deps)) {
			throw new Error(
				serviceId === dependsOnId
					? "A service can't depend on itself."
					: "That would make the two services depend on each other.",
			);
		}
		const row: ServiceDependency = {
			createdAt: new Date(),
			dependsOnId,
			id: crypto.randomUUID(),
			serviceId,
		};
		await db.insert(serviceDependency).values(row).onConflictDoNothing();
		return new ServiceDependencyDTO(row);
	}

	/** Deletes the dependency of `serviceId` on `dependsOnId`, returning whether there was one. */
	static async remove(
		serviceId: string,
		dependsOnId: string,
	): Promise<boolean> {
		const deleted = await db
			.delete(serviceDependency)
			.where(
				and(
					eq(serviceDependency.serviceId, serviceId),
					eq(serviceDependency.dependsOnId, dependsOnId),
				),
			)
			.returning({ id: serviceDependency.id });
		return deleted.length > 0;
	}

	/** The id of the service that depends on the other. */
	get serviceId(): string {
		return this.row.serviceId;
	}

	/** The id of the service it depends on. */
	get dependsOnId(): string {
		return this.row.dependsOnId;
	}
}
