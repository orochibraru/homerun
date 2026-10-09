import { z } from "zod";
import { IAC_TOOLS } from "#lib/iac/tools.js";

export const iacProjectApiBody = z.object({
	bucket: z
		.string()
		.min(1)
		.meta({ description: "The bucket the state lives in" }),
	name: z.string().min(1),
	prefix: z
		.string()
		.optional()
		.meta({ description: "A folder in the bucket, empty for its root" }),
	scope: z.string().nullable().optional().meta({
		description: "What the project manages: stack:<id> or service:<id>",
	}),
	storeId: z
		.string()
		.min(1)
		.meta({ description: "The object store holding the bucket" }),
	tool: z
		.enum(IAC_TOOLS)
		.optional()
		.meta({ description: "The tool managing it, terraform when omitted" }),
});
