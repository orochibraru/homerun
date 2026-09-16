import { StackDTO } from "$lib/dto/stack-dto";
import { parseListQuery } from "$lib/server/list-query";

export const load = async ({ parent, url }) => {
	const { user } = await parent();

	const query = parseListQuery(url);
	const paged = await StackDTO.listWithServiceCountsPaged(user.id, query);

	return {
		filtered: query.active,
		page: paged.page,
		perPage: paged.perPage,
		stacks: paged.items.map((r) => ({
			...r.stack.toJSON(),
			serviceCount: r.serviceCount,
		})),
		total: paged.total,
	};
};
