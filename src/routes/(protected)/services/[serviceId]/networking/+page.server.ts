import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Services");

// Loose hostname check — real validation is "does DNS for this actually
// point here", which the app has no way to verify; this just rejects
// obviously-malformed input.
const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export const actions = {
  updateNetworking: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const formData = await request.formData();
    const raw = (formData.get("customDomain") as string | null)?.trim() ?? "";
    const customDomain = raw.toLowerCase() || null;
    const authRequired = formData.get("authRequired") === "on";

    if (customDomain && !DOMAIN_RE.test(customDomain)) {
      return fail(400, { error: "That doesn't look like a valid domain." });
    }
    if (
      customDomain &&
      (await ServiceDTO.customDomainTaken(customDomain, svc.id))
    ) {
      return fail(400, {
        error: "That domain is already mapped to another service.",
      });
    }

    await svc.update({ authRequired, customDomain });
    logger.info(
      `Networking updated: service=${svc.id} domain=${customDomain ?? "none"} authRequired=${authRequired} user=${locals.user.id}`
    );
    return { success: true };
  },
};
