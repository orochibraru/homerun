import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { dependencyMap } from "$lib/service-graph";
import { descendantIds } from "$lib/stack-tree";

export const load = async ({ params, parent }) => {
	await parent();
	const [services, stacks] = await Promise.all([
		ServiceDTO.list(),
		StackDTO.list(),
	]);
	const stackNodes = stacks.map((s) => ({
		id: s.id,
		name: s.name,
		parentId: s.parentId,
		slug: s.slug,
	}));
	const inTree = new Set([
		params.stackId,
		...descendantIds(params.stackId, stackNodes),
	]);
	const deps = dependencyMap(
		services.map((svc) => ({
			envVars: svc.envVars,
			id: svc.id,
			slug: svc.slug,
		})),
	);
	const members = services.filter(
		(svc) => svc.stackId && inTree.has(svc.stackId),
	);
	const referenced = new Set(members.flatMap((svc) => deps.get(svc.id) ?? []));
	const graphServices = services
		.filter((svc) => members.includes(svc) || referenced.has(svc.id))
		.map((svc) => {
			const row = svc.toJSON();
			return {
				category: row.category,
				containerId: row.containerId,
				currentStatus: row.currentStatus,
				desiredState: row.desiredState,
				icon: row.icon,
				id: row.id,
				image: `${row.image}:${row.tag}`,
				name: row.name,
				slug: row.slug,
				stackId: row.stackId,
			};
		});

	return {
		allServices: services.map((svc) => ({
			id: svc.id,
			image: svc.image,
			name: svc.name,
			stackId: svc.stackId,
		})),
		graph: {
			deps: Object.fromEntries(
				graphServices.map((svc) => [svc.id, deps.get(svc.id) ?? []]),
			),
			services: graphServices,
			stacks: stackNodes.filter((s) => inTree.has(s.id)),
		},
		stacks: stackNodes,
	};
};
