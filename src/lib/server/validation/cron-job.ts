import { z } from "zod";

const optionalNumber = (schema: z.ZodNumber | z.ZodCoercedNumber) =>
	z.preprocess(
		(val) => (val === "" || val === undefined ? undefined : val),
		schema.optional(),
	);

export const cronJobSchema = z
	.object({
		command: z.string().optional(),
		description: z.string().optional(),
		enabled: z.preprocess((val) => val === "on" || val === true, z.boolean()),
		image: z.string().optional(),
		kind: z.enum(["image", "exec"]),
		name: z.string().min(1, "Name is required.").max(100),
		registryPassword: z.string().optional(),
		registryUrl: z.string().optional(),
		registryUsername: z.string().optional(),
		schedule: z.string().min(1, "Schedule is required."),
		tag: z.string().optional(),
		timeoutSeconds: optionalNumber(z.coerce.number().int().min(10).max(86_400)),
	})
	.superRefine((input, ctx) => {
		if (input.kind === "image" && !input.image?.trim()) {
			ctx.addIssue({
				code: "custom",
				message: "Image is required.",
				path: ["image"],
			});
		}
		if (input.kind === "exec" && !input.command?.trim()) {
			ctx.addIssue({
				code: "custom",
				message: "Command is required.",
				path: ["command"],
			});
		}
	});

export type CronJobInput = z.infer<typeof cronJobSchema>;

export const DEFAULT_CRON_JOB_TIMEOUT_SECONDS = 900;
