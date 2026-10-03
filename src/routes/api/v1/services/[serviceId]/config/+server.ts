import { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceVolumeDTO } from "#lib/dto/service-volume-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { serviceConfig } from "#lib/service-config.js";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const [stack, mounts] = await Promise.all([
		svc.stackId ? StackDTO.get(svc.stackId) : null,
		ServiceVolumeDTO.listForService(svc.id),
	]);
	return Response.json(
		serviceConfig(svc.toJSON(), {
			mounts: mounts.map((m) => ({
				containerPath: m.mount.toJSON().containerPath,
				kind: m.volumeKind,
				name: m.volumeName,
				readOnly: m.mount.toJSON().readOnly,
				source: m.volumeSource,
			})),
			stack: stack ? { id: stack.id, name: stack.name } : null,
		}),
	);
};
