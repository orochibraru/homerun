import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { detectDrift } from "#lib/iac/drift.js";
import { detectPulumiDrift } from "#lib/iac/pulumi.js";
import { usesHttpBackend } from "#lib/iac/tools.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async ({ parent, url }) => {
	const { project, user } = await parent();
	const row = await IacProjectDTO.get(project.id);
	if (!row) {
		return { problem: null, report: null, stack: null, stacks: [] };
	}
	if (usesHttpBackend(project.tool)) {
		try {
			const body = await IacStateService.read(row);
			if (!body) {
				return {
					problem: "Nothing has been written to this state yet.",
					report: null,
					stack: null,
					stacks: [],
				};
			}
			return {
				problem: null,
				report: detectDrift(body, await IacInventoryService.inventory(user.id)),
				stack: null,
				stacks: [],
			};
		} catch (err) {
			return {
				problem: `Couldn't read the state: ${reason(err)}`,
				report: null,
				stack: null,
				stacks: [],
			};
		}
	}
	try {
		const files = await IacStateService.pulumiStacks(row);
		const stacks = files.map((file) => file.name);
		const picked =
			files.find((file) => file.name === url.searchParams.get("stack")) ??
			files[0];
		if (!picked) {
			return {
				problem:
					"No Pulumi stack in this project's folder yet. Run pulumi up once with the login command on the State tab.",
				report: null,
				stack: null,
				stacks,
			};
		}
		const [body, inventory] = await Promise.all([
			IacStateService.pulumiCheckpoint(row, picked.key),
			IacInventoryService.inventory(user.id),
		]);
		return {
			problem: null,
			report: detectPulumiDrift(body, inventory),
			stack: picked.name,
			stacks,
		};
	} catch (err) {
		return {
			problem: `Couldn't read the checkpoint: ${reason(err)}`,
			report: null,
			stack: null,
			stacks: [],
		};
	}
};
