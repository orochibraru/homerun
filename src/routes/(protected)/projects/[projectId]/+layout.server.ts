import { error } from "@sveltejs/kit";
import { ProjectDTO } from "$lib/dto/project-dto";

export const load = async ({ params, parent }) => {
	const { user } = await parent();

	const proj = await ProjectDTO.get(params.projectId, user.id);
	if (!proj) {
		error(404, "Project not found");
	}

	return { project: proj.toJSON() };
};
