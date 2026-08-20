import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";

const logger = new Logger("RemoteHosts");

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }

    const formData = await request.formData();
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const dockerHost =
      (formData.get("dockerHost") as string | null)?.trim() ?? "";
    const tlsCa = (formData.get("tlsCa") as string | null)?.trim();
    const tlsCert = (formData.get("tlsCert") as string | null)?.trim();
    const tlsKey = (formData.get("tlsKey") as string | null)?.trim();

    if (!name) {
      return fail(400, { error: "Name is required." });
    }
    let url: URL;
    try {
      url = new URL(dockerHost);
    } catch {
      return fail(400, {
        error:
          "Docker host must be a URL, e.g. tcp://host:2376 or ssh://user@host.",
      });
    }
    if (!(url.protocol === "tcp:" || url.protocol === "ssh:")) {
      return fail(400, {
        error: "Only tcp:// and ssh:// hosts are supported.",
      });
    }

    const host = await RemoteHostDTO.create({
      dockerHost,
      name,
      tlsCaEnc: tlsCa ? encryptSecret(tlsCa) : null,
      tlsCertEnc: tlsCert ? encryptSecret(tlsCert) : null,
      tlsKeyEnc: tlsKey ? encryptSecret(tlsKey) : null,
      userId: locals.user.id,
    });

    logger.info(
      `Remote host added: host=${host.id} dockerHost=${dockerHost} user=${locals.user.id}`
    );

    return { success: true };
  },
};
