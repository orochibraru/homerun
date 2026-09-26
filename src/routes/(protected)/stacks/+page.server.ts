import { StackDTO } from "$lib/dto/stack-dto";
import { STACK_SORTS, sortKeysOf } from "$lib/list-sorts";
import { parseListQuery } from "$lib/server/list-query";
import { descendantIds, stackPath } from "$lib/stack-tree";

export const load = async ({ parent, url }) => {
	await parent();

	const query = parseListQuery(url, { sortKeys: sortKeysOf(STACK_SORTS) });
	const [paged, all] = await Promise.all([
		StackDTO.listWithServiceCountsPaged(query, { topLevelOnly: true }),
		StackDTO.list(),
	]);
	const nodes = all.map((s) => ({
		id: s.id,
		name: s.name,
		parentId: s.parentId,
		slug: s.slug,
	}));

	return {
		allStacks: nodes,
		filtered: query.active,
		page: paged.page,
		perPage: paged.perPage,
		stacks: paged.items.map((r) => ({
			...r.stack.toJSON(),
			path: stackPath(r.stack.id, nodes),
			serviceCount: r.serviceCount,
			substackCount: descendantIds(r.stack.id, nodes).length,
		})),
		total: paged.total,
	};
};
