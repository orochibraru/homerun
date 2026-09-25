import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";

export const load = async ({ parent }) => {
	await parent();
	const [services, stacks] = await Promise.all([
		ServiceDTO.list(),
		StackDTO.list(),
	]);

	return {
		allServices: services.map((svc) => ({
			id: svc.id,
			image: svc.image,
			name: svc.name,
			stackId: svc.stackId,
		})),
		stacks: stacks.map((stack) => ({ id: stack.id, name: stack.name })),
	};
};
