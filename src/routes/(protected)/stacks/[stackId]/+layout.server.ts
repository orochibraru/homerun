import { resolve } from "$app/paths";
import { error } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { ancestorIds, descendantIds } from "#lib/stack-tree.js";

export const load = async ({ params, parent }) => {
	await parent();

	const stack = await StackDTO.get(params.stackId);
	if (!stack) {
		error(404, "Stack not found");
	}
	const [services, all] = await Promise.all([
		ServiceDTO.listByStack(stack.id),
		StackDTO.list(),
	]);
	const parents = new Map(all.map((s) => [s.id, s.parentId]));
	const names = new Map(all.map((s) => [s.id, s.name]));

	const nested = await Promise.all(
		descendantIds(stack.id, all).map((id) => ServiceDTO.listByStack(id)),
	);
	const serviceCount = [services, ...nested]
		.flat()
		.filter((s) => !s.toJSON().previewParentId).length;

	const ancestors = ancestorIds(stack.id, parents)
		.reverse()
		.map((id) => ({ id, name: names.get(id) ?? "?" }));

	return {
		crumbRoot: [
			{ href: resolve("stacks"), label: "Stacks" },
			...ancestors.map((a) => ({
				href: resolve("/(protected)/stacks/[stackId]", { stackId: a.id }),
				label: a.name,
			})),
		],
		serviceCount,
		services: services.map((s) => s.toJSON()),
		stack: stack.toJSON(),
	};
};
