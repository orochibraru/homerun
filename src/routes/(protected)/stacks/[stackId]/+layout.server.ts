import { error } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { ancestorIds } from "$lib/stack-tree";

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

	return {
		ancestors: ancestorIds(stack.id, parents)
			.reverse()
			.map((id) => ({ id, name: names.get(id) ?? "?" })),
		services: services.map((s) => s.toJSON()),
		stack: stack.toJSON(),
	};
};
