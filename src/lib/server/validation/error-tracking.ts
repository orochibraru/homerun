import { z } from "zod";

const checkbox = z
	.string()
	.optional()
	.transform((value) => value === "on" || value === "true");

/** The Errors tab's settings form: the switches of a service's error tracking project. */
export const errorProjectSettingsSchema = z.object({
	injectEnv: checkbox,
	internalDsn: checkbox,
});

/** The Errors tab's status change, one issue or the bulk bar's selection. */
export const issueStatusFormSchema = z.object({
	issueId: z.array(z.string().min(1)).min(1, "No issues selected.").max(500),
	status: z.enum(["unresolved", "resolved", "ignored"]),
});
