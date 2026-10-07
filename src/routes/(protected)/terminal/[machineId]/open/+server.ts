import { z } from "zod";
import {
	MachineTerminalError,
	MachineTerminalService,
} from "#lib/services/machine-terminal.service.js";

const sizeSchema = z.object({
	cols: z.int().min(1).max(1000),
	rows: z.int().min(1).max(1000),
});

export const POST = async ({ params, request, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const size = sizeSchema.safeParse(await request.json().catch(() => null));
	try {
		const sessionId = await MachineTerminalService.open(
			params.machineId,
			locals.user.id,
			size.success ? size.data : { cols: 80, rows: 24 },
		);
		return Response.json({ sessionId });
	} catch (err) {
		if (err instanceof MachineTerminalError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		throw err;
	}
};
