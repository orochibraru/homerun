import { z } from "zod";

// Same "" → undefined preprocessing precedent as validation/service.ts's
// optionalNumber : an empty <input type="number"> still submits "" in
// FormData, and z.coerce.number() would otherwise turn that into 0 rather
// than failing the intended "not provided" case.
const optionalNumber = (schema: z.ZodNumber | z.ZodCoercedNumber) =>
	z.preprocess(
		(val) => (val === "" || val === undefined ? undefined : val),
		schema.optional(),
	);

// Checkbox convention (also used below, and in validation/service.ts):
// present ("on") when checked, absent from FormData entirely when
// unchecked : never a literal "false" to coerce.
const checkbox = z.preprocess(
	(val) => val === "on" || val === true,
	z.boolean(),
);

const requiredText = (label: string) =>
	z.string().trim().min(1, `${label} is required.`);

export const onboardingSchema = z
	.object({
		authCrossSubdomainCookies: checkbox,
		baseDomain: requiredText("Base domain"),
		// Optional, not required : real, tested-in-review bug this replaced.
		// Both fields were `requiredText`, pre-filled from the *current*
		// effective default (envDefaults, see +page.svelte), so finishing
		// onboarding always persisted a concrete DB override even when the
		// admin never touched either field, just clicked through with the
		// pre-filled value. That override then permanently shadows any
		// future improvement to what the default actually computes (verified
		// live : $lib/config.ts's docker.socketPath auto-detection landed
		// after this override already existed in a real dev DB, and kept
		// silently losing to the stale onboarding-persisted "/var/run/docker.sock"
		// forever, `override ?? envDefaults` always preferring the override).
		// Blank now means "no override, use the effective default", same
		// `nullableText()` convention settings/+page.server.ts's own Docker
		// section already uses.
		dockerNetworkName: z.string().optional(),
		dockerSocketPath: z.string().optional(),
		smtpEnabled: checkbox,
		smtpFrom: z.string().optional(),
		smtpHost: z.string().optional(),
		smtpPassword: z.string().optional(),
		smtpPort: optionalNumber(z.coerce.number().int().min(1).max(65_535)),
		smtpSecure: checkbox,
		smtpUser: z.string().optional(),
		traefikCertResolver: requiredText("Cert resolver"),
		traefikDynamicConfigDir: z.string().optional(),
		traefikEntrypoint: requiredText("Entrypoint"),
		// Origin isn't a separate typed field, same as settings/+page.server.ts's
		// updateCore action : it's derived from baseDomain plus this checkbox,
		// so onboarding only ever asks for one domain, not two URLs.
		useHttps: checkbox,
	})
	.superRefine((input, ctx) => {
		if (!input.smtpEnabled) {
			return;
		}
		const required: [keyof typeof input, string][] = [
			["smtpHost", "Host"],
			["smtpUser", "Username"],
			["smtpFrom", "From address"],
		];
		for (const [field, label] of required) {
			if (!input[field]) {
				ctx.addIssue({
					code: "custom",
					message: `${label} is required when SMTP is enabled.`,
					path: [field],
				});
			}
		}
		if (!input.smtpPort) {
			ctx.addIssue({
				code: "custom",
				message: "Port is required when SMTP is enabled.",
				path: ["smtpPort"],
			});
		}
	});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
