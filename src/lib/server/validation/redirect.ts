import { z } from "zod";
import { normalizeDestination, normalizeSource } from "#lib/redirects.js";

const checkbox = z.preprocess(
	(val) => val === "on" || val === true,
	z.boolean(),
);

export const redirectSchema = z
	.object({
		destination: z.string().trim().min(1, "Destination is required."),
		enabled: checkbox,
		keepPath: checkbox,
		permanent: checkbox,
		source: z.string().trim().min(1, "Source is required."),
	})
	.transform((input, ctx) => {
		const source = normalizeSource(input.source);
		if (!source) {
			ctx.addIssue({
				code: "custom",
				message:
					'Source is a hostname with an optional path prefix, e.g. "old.example.com" or "example.com/blog".',
				path: ["source"],
			});
		}
		const destination = normalizeDestination(input.destination);
		if (!destination) {
			ctx.addIssue({
				code: "custom",
				message: "Destination must be a full http(s) URL.",
				path: ["destination"],
			});
		}
		return { ...input, destination: destination ?? "", source: source ?? "" };
	});

export type RedirectInput = z.infer<typeof redirectSchema>;
