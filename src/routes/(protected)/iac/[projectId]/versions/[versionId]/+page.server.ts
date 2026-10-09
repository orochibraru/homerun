import { error } from "@sveltejs/kit";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const load = async ({ params }) => {
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		error(404, "That IaC project doesn't exist.");
	}
	const diff = await IacStateService.diff(project, params.versionId).catch(
		(cause: unknown) =>
			error(404, cause instanceof Error ? cause.message : String(cause)),
	);
	return {
		diff,
		project: { id: project.id, name: project.name },
	};
};
