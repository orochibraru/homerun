import { error } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";

export const load = async ({ params, parent }) => {
	await parent();

	const stack = await StackDTO.get(params.stackId);
	if (!stack) {
		error(404, "Stack not found");
	}
	const services = await ServiceDTO.listByStack(stack.id);

	return {
		services: services.map((s) => s.toJSON()),
		stack: stack.toJSON(),
	};
};
