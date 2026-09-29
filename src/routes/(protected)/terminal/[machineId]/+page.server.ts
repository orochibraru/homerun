import { error } from "@sveltejs/kit";
import { MachineTerminalService } from "$lib/services/machine-terminal.service";

export const load = async ({ params }) => {
	const machine = await MachineTerminalService.machine(params.machineId);
	if (!machine) {
		error(404, "Machine not found");
	}
	return { machine };
};
