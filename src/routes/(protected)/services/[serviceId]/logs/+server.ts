import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { streamLogs } from "$lib/server/docker/service";

export const GET = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
  if (!svc) {
    return new Response("Not found", { status: 404 });
  }
  if (!svc.containerId) {
    return new Response("This service hasn't been deployed yet.", {
      status: 400,
    });
  }

  const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
  const stream = await streamLogs(
    svc.containerId,
    { follow: true, tail: 200 },
    remote
  );
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
