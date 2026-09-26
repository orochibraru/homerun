import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type ServiceDependency,
	serviceDependency,
} from "$lib/server/db/schema";
import {
	backfillEdges,
	createsCycle,
	type DependencySource,
	dependencyEdges,
	dependencyMap,
	replacementCycle,
} from "$lib/service-graph";
import { BaseDTO } from "./base-dto";
import { ServiceDTO } from "./service-dto";

export interface DependencyRef {
	id: string;
	name: string;
	slug: string;
	source: DependencySource;
}

export interface ServiceDependencies {
	dependedOnBy: DependencyRef[];
	dependsOn: DependencyRef[];
}

/** A dependency change refused for the caller's input: an unknown service, itself, or a loop. */
export class ServiceDependencyError extends Error {}

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

	/**
	 * What `serviceId` depends on and what depends on it, recorded or read
	 * off env values, each with its name, slug and where the edge comes from.
	 */
	static async describe(serviceId: string): Promise<ServiceDependencies> {
		const services = await ServiceDTO.list();
		const byId = new Map(services.map((svc) => [svc.id, svc]));
		const edges = dependencyEdges(
			serviceId,
			dependencyMap(
				services.map((svc) => ({
					envVars: svc.envVars,
					id: svc.id,
					slug: svc.slug,
				})),
			),
			await ServiceDependencyDTO.map(),
		);
		const refs = (list: { id: string; source: DependencySource }[]) =>
			list.flatMap(({ id, source }) => {
				const svc = byId.get(id);
				return svc ? [{ id, name: svc.name, slug: svc.slug, source }] : [];
			});
		return {
			dependedOnBy: refs(edges.dependedOnBy),
			dependsOn: refs(edges.dependsOn),
		};
	}

	/**
	 * Replaces the recorded dependencies of `serviceId` with `ids`, leaving
	 * env links alone.
	 *
	 * @throws {ServiceDependencyError} When an id isn't a service, is
	 * `serviceId` itself, or already depends on it at any depth.
	 */
	static async replace(serviceId: string, ids: string[]): Promise<void> {
		const wanted = [...new Set(ids)];
		const known = new Set((await ServiceDTO.list()).map((svc) => svc.id));
		const unknown = wanted.filter((id) => !known.has(id));
		if (unknown.length > 0) {
			throw new ServiceDependencyError(
				`No service with id ${unknown.join(", ")}.`,
			);
		}
		const loop = replacementCycle(
			serviceId,
			wanted,
			await ServiceDependencyDTO.map(),
		);
		if (loop) {
			throw new ServiceDependencyError(
				loop === serviceId
					? "A service can't depend on itself."
					: `${loop} already depends on this service, so depending on it would make a loop.`,
			);
		}
		await db.transaction(async (tx) => {
			await tx
				.delete(serviceDependency)
				.where(eq(serviceDependency.serviceId, serviceId));
			if (wanted.length > 0) {
				await tx.insert(serviceDependency).values(
					wanted.map((dependsOnId) => ({
						createdAt: new Date(),
						dependsOnId,
						id: crypto.randomUUID(),
						serviceId,
					})),
				);
			}
		});
	}

	/**
	 * Records the dependencies of services linked before this table existed,
	 * read off their env values (see `backfillEdges`). Cheap and idempotent:
	 * a consumer with any recorded dependency is left alone, so it only acts
	 * once per service.
	 *
	 * @returns How many rows were added, and each skipped loop as slugs.
	 */
	static async backfillFromEnv(since = new Date()): Promise<{
		added: number;
		cycles: string[];
	}> {
		const services = await ServiceDTO.list();
		const slugOf = new Map(services.map((svc) => [svc.id, svc.slug]));
		const { add, cycles } = backfillEdges(
			services.map((svc) => ({
				createdAt: svc.toJSON().createdAt,
				envVars: svc.envVars,
				id: svc.id,
				image: svc.image,
				slug: svc.slug,
				stackId: svc.stackId,
			})),
			await ServiceDependencyDTO.map(),
			since,
		);
		let added = 0;
		for (const [serviceId, dependsOnId] of add) {
			// oxlint-disable-next-line no-await-in-loop -- each add re-checks for loops against the rows before it
			await ServiceDependencyDTO.add(serviceId, dependsOnId);
			added++;
		}
		return {
			added,
			cycles: cycles.map(
				([from, to]) => `${slugOf.get(from)} → ${slugOf.get(to)}`,
			),
		};
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
