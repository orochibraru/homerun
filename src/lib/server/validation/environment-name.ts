import { z } from "zod";
import { environmentNameProblem } from "$lib/release-channels";

export const environmentNameField = z
	.string()
	.trim()
	.toLowerCase()
	.nullable()
	.superRefine((value, ctx) => {
		const problem = environmentNameProblem(value ?? "");
		if (problem) {
			ctx.addIssue({ code: "custom", message: problem });
		}
	});
