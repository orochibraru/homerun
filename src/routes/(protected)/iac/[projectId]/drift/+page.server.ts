import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { detectDrift } from "#lib/iac/drift.js";
import { usesHttpBackend } from "#lib/iac/tools.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const load = async ({ parent }) => {
	const { project, user } = await parent();
	const row = await IacProjectDTO.get(project.id);
	if (!(row && usesHttpBackend(project.tool))) {
		return { problem: null, report: null };
	}
	try {
		const body = await IacStateService.read(row);
		if (!body) {
			return {
				problem: "Nothing has been written to this state yet.",
				report: null,
			};
		}
		return {
			problem: null,
			report: detectDrift(body, await IacInventoryService.inventory(user.id)),
		};
	} catch (err) {
		return {
			problem: `Couldn't read the state: ${err instanceof Error ? err.message : String(err)}`,
			report: null,
		};
	}
};
