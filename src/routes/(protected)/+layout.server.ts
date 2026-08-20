import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { hasAnyUser } from "$lib/server/onboarding";

export const load = async ({ locals, route }) => {
  if (!locals.user) {
    // A blank instance has nothing to sign into — go create the admin
    // account instead (same check /auth/sign-in's own load makes).
    throw redirect(
      302,
      resolve((await hasAnyUser()) ? "/auth/sign-in" : "/auth/sign-up")
    );
  }

  // Onboarding is instance-wide state (the singleton instance_settings
  // row), not per-user — once the bootstrap admin finishes it, later
  // accounts never see the wizard. Gated both directions here, as the
  // single source of truth for both.
  //
  // Real, tested-in-review finding: comparing `url.pathname` against
  // `resolve("/onboarding")` doesn't work — this app's `resolve()` (see
  // $app/paths) returns a *relative* path ("./onboarding"), not an
  // absolute one, so it never equals `url.pathname` ("/onboarding").
  // Verified live: that comparison was always false, causing a redirect
  // loop back onto /onboarding itself. `route.id` doesn't have that
  // problem — it's the router's own canonical, absolute route identifier
  // (confirmed live: "/(protected)/onboarding" for this route), not a
  // derived URL string.
  const settings = await InstanceSettingsDTO.get();
  const onboardingDone = settings.onboardingComplete;
  const onOnboardingRoute = route.id === "/(protected)/onboarding";

  if (!(onboardingDone || onOnboardingRoute)) {
    throw redirect(302, resolve("/onboarding"));
  }
  if (onboardingDone && onOnboardingRoute) {
    throw redirect(302, resolve("/"));
  }

  return {
    onboardingDone,
    user: locals.user,
  };
};
