import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Storage");

export const load = async ({ parent }) => {
  const { user } = await parent();
  const volumes = await StorageVolumeDTO.list(user.id);

  return { volumes: volumes.map((v) => v.toJSON()) };
};

export const actions = {
  delete: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const data = await request.formData();
    const volumeId = data.get("volumeId") as string | null;
    if (!volumeId) {
      return fail(400, { error: "Missing volume id." });
    }

    const vol = await StorageVolumeDTO.get(volumeId, locals.user.id);
    if (!vol) {
      return fail(404, { error: "Volume not found." });
    }

    await vol.delete();
    logger.info(
      `Storage volume deleted: volume=${volumeId} user=${locals.user.id}`
    );
    return { success: true };
  },
};
