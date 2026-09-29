import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	MachineTerminalError,
	MachineTerminalService,
} from "$lib/services/machine-terminal.service";

const sizeSchema = z.object({
	cols: z.int().min(1).max(1000),
	rows: z.int().min(1).max(1000),
});

export const POST = async ({ params, request, locals }) => {
	if (!(locals.user && locals.isAdmin)) {
		return json(
			{ error: "Only an admin can open a machine's terminal." },
			{ status: 403 },
		);
	}
	const size = sizeSchema.safeParse(await request.json().catch(() => null));
	try {
		const sessionId = await MachineTerminalService.open(
			params.machineId,
			locals.user.id,
			size.success ? size.data : { cols: 80, rows: 24 },
		);
		return json({ sessionId });
	} catch (err) {
		if (err instanceof MachineTerminalError) {
			return json({ error: err.message }, { status: err.status });
		}
		throw err;
	}
};
