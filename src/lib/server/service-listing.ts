import { serviceDomain } from "#lib/config.js";
import { ServiceDependencyDTO } from "#lib/dto/service-dependency-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceGitDTO } from "#lib/dto/service-git-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import type { ListQuery } from "#lib/server/list-query.js";
import { primaryHostname } from "#lib/service-domains.js";
import {
	dependencyMap,
	mergeDependencies,
	toGraphService,
	toPreviewRow,
} from "#lib/service-graph.js";

/** One page of services with their stack names and pull request previews. */
async function loadServices(query: ListQuery) {
	const paged = await ServiceDTO.listWithStackNamesPaged(query);
	const previews = await ServiceGitDTO.listPreviewsOf(
		paged.items.map((r) => r.service.id),
	);

	return {
		services: paged.items.map((r) => ({
			...r.service.toJSON(),
			previews: (previews.get(r.service.id) ?? []).map((p) =>
				toPreviewRow(p.toJSON()),
			),
			stackName: r.stackName,
		})),
		total: paged.total,
	};
}

/** The services page's list, one page of `query`, (or, with `treeView`, its dependency tree), plus the stacks it groups by. */
export async function loadServiceListing(query: ListQuery, treeView: boolean) {
	const [{ services, total }, stacks, everything] = await Promise.all([
		loadServices(query),
		StackDTO.list(),
		treeView ? ServiceDTO.list() : null,
	]);

	const roots = (everything ?? []).filter(
		(svc) => !svc.toJSON().previewParentId,
	);
	return {
		stacks: stacks.map((p) => ({
			id: p.id,
			name: p.name,
			parentId: p.parentId,
			slug: p.slug,
		})),
		services,
		total,
		tree: everything && {
			deps: Object.fromEntries(
				mergeDependencies(
					dependencyMap(
						roots.map((svc) => ({
							envVars: svc.envVars,
							id: svc.id,
							slug: svc.slug,
						})),
					),
					await ServiceDependencyDTO.map(),
				),
			),
			previews: everything
				.filter((svc) => svc.toJSON().previewParentId)
				.map((svc) => toPreviewRow(svc.toJSON())),
			services: roots.map((svc) => {
				const row = svc.toJSON();
				return {
					...toGraphService(row),
					swarmServiceId: row.swarmServiceId,
					domain: primaryHostname(
						row,
						stacks.find((stack) => stack.id === row.stackId)?.slug,
						serviceDomain(),
					),
				};
			}),
		},
	};
}

export type ServiceListing = Awaited<ReturnType<typeof loadServiceListing>>;

/** The services page's filter options plus its headline counts: top-level services by status, their total, and how many stacks hold one. */
export async function loadServiceFacets() {
	const [facets, services] = await Promise.all([
		ServiceDTO.listFilterFacets(),
		ServiceDTO.list(),
	]);
	const roots = services
		.map((svc) => svc.toJSON())
		.filter((row) => !row.previewParentId);
	const statusCounts: Record<string, number> = {};
	for (const row of roots) {
		statusCounts[row.currentStatus] =
			(statusCounts[row.currentStatus] ?? 0) + 1;
	}
	return {
		...facets,
		stackCount: new Set(roots.flatMap((row) => row.stackId ?? [])).size,
		statusCounts,
		total: roots.length,
	};
}

export type ServiceFacets = Awaited<ReturnType<typeof loadServiceFacets>>;
