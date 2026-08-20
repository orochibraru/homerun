/**
 * Which step a given onboarding field lives on — shared between the client
 * wizard (jumping to the first invalid step, both on a blocked client-side
 * "Next"/submit and after a server fail()) and the server action (mapping
 * a zod field-error back to a step). Deliberately not under $lib/server/ —
 * the onboarding page imports this directly, and anything under
 * $lib/server/ is illegal to import from client-bundled code (even for a
 * plain object, not just server logic) — see
 * $lib/server/validation/onboarding.ts for the zod schema itself, which is
 * genuinely server-only and only used from the onboarding +page.server.ts
 * action.
 */
export const ONBOARDING_FIELD_STEP: Record<string, number> = {
	authCrossSubdomainCookies: 0,
	authOrigin: 0,
	baseDomain: 0,
	dockerNetworkName: 1,
	dockerSocketPath: 1,
	smtpEnabled: 3,
	smtpFrom: 3,
	smtpHost: 3,
	smtpPassword: 3,
	smtpPort: 3,
	smtpSecure: 3,
	smtpUser: 3,
	traefikCertResolver: 2,
	traefikDynamicConfigDir: 2,
	traefikEntrypoint: 2,
};
