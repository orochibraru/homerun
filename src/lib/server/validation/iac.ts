import { z } from "zod";

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
	storeId: z
		.string()
		.min(1)
		.meta({ description: "The object store holding the bucket" }),
});
