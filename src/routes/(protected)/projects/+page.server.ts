import { ProjectDTO } from "$lib/dto/project-dto";
import { parseListQuery } from "$lib/server/list-query";

export const load = async ({ parent, url }) => {
	const { user } = await parent();

	const query = parseListQuery(url);
	const paged = await ProjectDTO.listWithServiceCountsPaged(user.id, query);

	return {
		filtered: query.active,
		page: paged.page,
		perPage: paged.perPage,
		projects: paged.items.map((r) => ({
			...r.project.toJSON(),
			serviceCount: r.serviceCount,
		})),
		total: paged.total,
	};
};
