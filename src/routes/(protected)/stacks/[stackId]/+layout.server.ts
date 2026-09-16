import { error } from "@sveltejs/kit";
import { StackDTO } from "$lib/dto/stack-dto";

export const load = async ({ params, parent }) => {
	const { user } = await parent();

	const stack = await StackDTO.get(params.stackId, user.id);
	if (!stack) {
		error(404, "Stack not found");
	}

	return { stack: stack.toJSON() };
};
