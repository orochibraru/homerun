import { z } from "zod";

// Same "" → undefined preprocessing precedent as validation/service.ts's
// optionalNumber — an empty <input type="number"> still submits "" in
// FormData, and z.coerce.number() would otherwise turn that into 0 rather
// than failing the intended "not provided" case.
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => (val === "" || val === undefined ? undefined : val),
    schema.optional()
  );

// Checkbox convention (also used below, and in validation/service.ts):
// present ("on") when checked, absent from FormData entirely when
// unchecked — never a literal "false" to coerce.
const checkbox = z.preprocess(
  (val) => val === "on" || val === true,
  z.boolean()
);

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required.`);

export const onboardingSchema = z
  .object({
    authCrossSubdomainCookies: checkbox,
    authOrigin: requiredText("Origin URL"),
    baseDomain: requiredText("Base domain"),
    dockerNetworkName: requiredText("Docker network name"),
    dockerSocketPath: requiredText("Docker socket path"),
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
