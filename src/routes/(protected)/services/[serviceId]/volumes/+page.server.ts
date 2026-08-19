import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Services");

export const load = async ({ params, parent }) => {
  const { user } = await parent();
  const [volumes, mounts] = await Promise.all([
    StorageVolumeDTO.list(user.id),
    ServiceVolumeDTO.listForService(params.serviceId),
  ]);

  return {
    mounts: mounts.map((m) => ({
      ...m.mount.toJSON(),
      volumeKind: m.volumeKind,
      volumeName: m.volumeName,
    })),
    volumes: volumes.map((v) => v.toJSON()),
  };
};

export const actions = {
  attachVolume: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const formData = await request.formData();
    const volumeId = formData.get("volumeId") as string | null;
    const containerPath = (
      formData.get("containerPath") as string | null
    )?.trim();
    const readOnly = formData.get("readOnly") === "on";

    if (!(volumeId && containerPath)) {
      return fail(400, { error: "Choose a volume and a mount path." });
    }
    if (!containerPath.startsWith("/")) {
      return fail(400, {
        error: "Mount path must be absolute (start with /).",
      });
    }

    const vol = await StorageVolumeDTO.get(volumeId, locals.user.id);
    if (!vol) {
      return fail(400, { error: "That volume wasn't found." });
    }

    await ServiceVolumeDTO.attach({
      containerPath,
      readOnly,
      serviceId: svc.id,
      volumeId: vol.id,
    });
    logger.info(
      `Volume mounted: service=${svc.id} volume=${vol.id} path=${containerPath} user=${locals.user.id}`
    );
    return { volumeAttached: true };
  },
  detachVolume: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const formData = await request.formData();
    const mountId = formData.get("mountId") as string | null;
    if (!mountId) {
      return fail(400, { error: "Missing mount id." });
    }

    // Ownership check happens by scoping to this service's own mounts —
    // never trust a mount id from the form alone.
    const mounts = await ServiceVolumeDTO.listForService(svc.id);
    const target = mounts.find((m) => m.mount.id === mountId);
    if (!target) {
      return fail(404, { error: "Mount not found." });
    }

    await target.mount.detach();
    logger.info(
      `Volume unmounted: service=${svc.id} mount=${mountId} user=${locals.user.id}`
    );
    return { volumeDetached: true };
  },
};
