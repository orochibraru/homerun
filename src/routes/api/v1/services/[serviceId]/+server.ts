import { json } from "@sveltejs/kit";
import { z } from "zod";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";
import { removeContainer } from "$lib/server/docker/service";

const logger = new Logger("API");

const updateServiceBody = z.object({
	authRequired: z.boolean().optional(),
	buildSource: z.enum(["image", "git"]).optional(),
	containerPort: z.number().int().min(1).max(65_535).optional(),
	cpuLimit: z.string().nullable().optional(),
	customDomain: z.string().nullable().optional(),
	dnsResolvable: z.boolean().optional(),
	envVars: z.record(z.string(), z.string()).optional(),
	gitBuildContext: z.string().nullable().optional(),
	gitDockerfilePath: z.string().nullable().optional(),
	gitRef: z.string().nullable().optional(),
	gitUrl: z.string().nullable().optional(),
	image: z.string().min(1).optional(),
	memoryLimitMb: z.number().int().positive().nullable().optional(),
	name: z.string().min(1).max(100).optional(),
	registryPassword: z.string().optional(),
	registryUrl: z.string().nullable().optional(),
	registryUsername: z.string().nullable().optional(),
	remoteHostId: z.string().nullable().optional(),
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
			{ status: 400 },
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
		`Service updated via API: service=${svc.id} user=${locals.user.id}`,
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
			const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
			await removeContainer(svc.containerId, { force: true }, remote);
		} catch {
			// Already gone on the host — proceed with deleting the record.
		}
	}
	await svc.delete();
	logger.info(
		`Service deleted via API: service=${svc.id} user=${locals.user.id}`,
	);
	return new Response(null, { status: 204 });
};
