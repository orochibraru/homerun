import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import {
  applyInstanceSettings,
  config,
  envDefaultsForDisplay,
} from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { rebuildAuth } from "$lib/server/auth";
import { onboardingSchema } from "$lib/server/validation/onboarding";

const logger = new Logger("Onboarding");

/** Blank optional field means "no override — fall back to the env default", same convention as settings/+page.server.ts's nullableText(). */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const load = async ({ locals }) => {
  // Onboarding is instance-wide, not per-user — a non-admin account can
  // exist before the bootstrap admin has finished it (created by that
  // admin before they got around to this step). They land here too (the
  // parent layout's gate doesn't know about roles), but get a holding
  // message instead of instance-wide config controls.
  if (!locals.isAdmin) {
    return { waitingForAdmin: true as const };
  }

  const settings = await InstanceSettingsDTO.get();
  return {
    authSecretIsDefault: config.auth.secret === "default-secret",
    envDefaults: envDefaultsForDisplay(),
    settings: settings.toJSON(),
    waitingForAdmin: false as const,
  };
};

export const actions = {
  finish: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    if (!locals.isAdmin) {
      throw redirect(302, resolve("/"));
    }

    const formData = await request.formData();
    const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        values: Object.fromEntries(formData),
      });
    }
    const input = parsed.data;

    const settings = await InstanceSettingsDTO.get();
    // authCheckUrl isn't part of this wizard (advanced/rarely-changed,
    // editable later on /settings) — preserve whatever it's currently set
    // to rather than resetting it.
    await settings.updateCore({
      authCheckUrl: settings.toJSON().authCheckUrl,
      authCrossSubdomainCookies: input.authCrossSubdomainCookies,
      authOrigin: input.authOrigin,
      baseDomain: input.baseDomain,
    });
    await settings.updateDocker({
      dockerNetworkName: input.dockerNetworkName,
      dockerSocketPath: input.dockerSocketPath,
    });
    await settings.updateTraefik({
      traefikCertResolver: input.traefikCertResolver,
      traefikDynamicConfigDir: blankToNull(input.traefikDynamicConfigDir),
      traefikEntrypoint: input.traefikEntrypoint,
    });
    await settings.updateSmtp({
      smtpEnabled: input.smtpEnabled,
      smtpFrom: blankToNull(input.smtpFrom),
      smtpHost: blankToNull(input.smtpHost),
      smtpPassword: input.smtpPassword?.trim() || undefined,
      smtpPort: input.smtpPort ?? null,
      smtpSecure: input.smtpSecure,
      smtpUser: blankToNull(input.smtpUser),
    });
    await settings.markOnboardingComplete();

    applyInstanceSettings(settings.toConfigOverride());
    rebuildAuth();

    logger.info(`Onboarding completed: user=${locals.user.id}`);
    throw redirect(302, resolve("/"));
  },
};
