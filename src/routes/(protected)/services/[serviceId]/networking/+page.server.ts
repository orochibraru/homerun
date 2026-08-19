import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { syncCustomSslConfig } from "$lib/server/docker/custom-ssl";
import { encryptSecret } from "$lib/server/docker/secrets";

const logger = new Logger("Services");

// Loose hostname check — real validation is "does DNS for this actually
// point here", which the app has no way to verify; this just rejects
// obviously-malformed input.
const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Blank fields mean "leave unchanged" (same convention as registryPassword elsewhere); the explicit clearSsl checkbox is the only way to actually remove a stored cert/key. */
function sslUpdateFields(
  clearSsl: boolean,
  cert: string | undefined,
  key: string | undefined
): { customSslCertEnc?: string | null; customSslKeyEnc?: string | null } {
  if (clearSsl) {
    return { customSslCertEnc: null, customSslKeyEnc: null };
  }
  if (cert && key) {
    return {
      customSslCertEnc: encryptSecret(cert),
      customSslKeyEnc: encryptSecret(key),
    };
  }
  return {};
}

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
    const customSslCert = (
      formData.get("customSslCert") as string | null
    )?.trim();
    const customSslKey = (
      formData.get("customSslKey") as string | null
    )?.trim();
    const clearSsl = formData.get("clearSsl") === "on";

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
    if (customSslCert && customSslKey && !customDomain) {
      return fail(400, {
        error: "A custom domain is required to attach a custom certificate.",
      });
    }

    await svc.update({
      authRequired,
      customDomain,
      ...sslUpdateFields(clearSsl, customSslCert, customSslKey),
    });

    await syncCustomSslConfig(svc);

    logger.info(
      `Networking updated: service=${svc.id} domain=${customDomain ?? "none"} authRequired=${authRequired} user=${locals.user.id}`
    );
    return { success: true };
  },
};
