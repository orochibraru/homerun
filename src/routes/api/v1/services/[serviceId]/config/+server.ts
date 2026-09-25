import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { serviceConfig } from "$lib/service-config";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const [stack, mounts] = await Promise.all([
		svc.stackId ? StackDTO.get(svc.stackId) : null,
		ServiceVolumeDTO.listForService(svc.id),
	]);
	return json(
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
