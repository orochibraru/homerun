import { json } from "@sveltejs/kit";
import { z } from "zod";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";
import { removeContainer } from "$lib/server/docker/service";

const logger = new Logger("API");

const updateServiceBody = z.object({
  containerPort: z.number().int().min(1).max(65_535).optional(),
  cpuLimit: z.string().nullable().optional(),
  dnsResolvable: z.boolean().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  image: z.string().min(1).optional(),
  memoryLimitMb: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(100).optional(),
  registryPassword: z.string().optional(),
  registryUrl: z.string().nullable().optional(),
  registryUsername: z.string().nullable().optional(),
  restartPolicy: z
    .enum(["no", "always", "on-failure", "unless-stopped"])
    .optional(),
  tag: z.string().min(1).optional(),
});

export const GET = async ({ params, locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
  if (!svc) {
    return json({ error: "Not found" }, { status: 404 });
  }
  return json(svc.toJSON());
};

export const PATCH = async ({ params, request, locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
  if (!svc) {
    return json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const result = updateServiceBody.safeParse(body);
  if (!result.success) {
    return json(
      { error: "Invalid request body", issues: result.error.flatten() },
      { status: 400 }
    );
  }
  const { registryPassword, ...rest } = result.data;

  await svc.update({
    ...rest,
    ...(registryPassword
      ? { registryPasswordEnc: encryptSecret(registryPassword) }
      : {}),
  });

  logger.info(
    `Service updated via API: service=${svc.id} user=${locals.user.id}`
  );
  return json(svc.toJSON());
};

export const DELETE = async ({ params, locals }) => {
  if (!locals.user) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
  if (!svc) {
    return json({ error: "Not found" }, { status: 404 });
  }

  if (svc.containerId) {
    try {
      await removeContainer(svc.containerId, { force: true });
    } catch {
      // Already gone on the host — proceed with deleting the record.
    }
  }
  await svc.delete();
  logger.info(
    `Service deleted via API: service=${svc.id} user=${locals.user.id}`
  );
  return new Response(null, { status: 204 });
};
