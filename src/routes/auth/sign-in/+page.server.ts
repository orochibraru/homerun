import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { hasAnyUser } from "$lib/server/onboarding";

export const load = async () => {
  // Nothing to sign into on a blank instance — go create the admin account.
  if (!(await hasAnyUser())) {
    throw redirect(302, resolve("/auth/sign-up"));
  }
};
