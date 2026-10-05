import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { detectDrift } from "#lib/iac/drift.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const load = async ({ parent, url }) => {
	const { projects, user } = await parent();
	const projectId =
		projects.find((project) => project.id === url.searchParams.get("project"))
			?.id ??
		projects[0]?.id ??
		"";
	const project = projectId ? await IacProjectDTO.get(projectId) : null;
	if (!project) {
		return { problem: null, projectId, report: null };
	}
	try {
		const body = await IacStateService.read(project);
		if (!body) {
			return {
				problem: "Nothing has been written to this state yet.",
				projectId,
				report: null,
			};
		}
		return {
			problem: null,
			projectId,
			report: detectDrift(body, await IacInventoryService.inventory(user.id)),
		};
	} catch (err) {
		return {
			problem: `Couldn't read the state: ${err instanceof Error ? err.message : String(err)}`,
			projectId,
			report: null,
		};
	}
};
