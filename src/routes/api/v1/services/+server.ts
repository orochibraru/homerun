import { json } from "@sveltejs/kit";
import { z } from "zod";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";

const logger = new Logger("API");

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

const createServiceBody = z
	.object({
		authRequired: z.boolean().default(false),
		buildSource: z.enum(["image", "git"]).default("image"),
		containerPort: z.number().int().min(1).max(65_535),
		cpuLimit: z.string().optional(),
		dnsResolvable: z.boolean().default(true),
		envVars: z.record(z.string(), z.string()).default({}),
		gitBuildContext: z.string().optional(),
		gitDockerfilePath: z.string().optional(),
		gitRef: z.string().optional(),
		gitUrl: z.string().optional(),
		image: z.string().optional(),
		memoryLimitMb: z.number().int().positive().optional(),
		name: z.string().min(1).max(100),
		projectId: z.string().optional(),
		registryPassword: z.string().optional(),
		registryUrl: z.string().optional(),
		registryUsername: z.string().optional(),
		restartPolicy: z
			.enum(["no", "always", "on-failure", "unless-stopped"])
			.default("unless-stopped"),
		slug: z.string().regex(SLUG_RE),
		tag: z.string().min(1).optional(),
	})
	.refine((v) => v.buildSource !== "git" || !!v.gitUrl, {
		error: 'gitUrl is required when buildSource is "git".',
		path: ["gitUrl"],
	})
	.refine((v) => v.buildSource === "git" || !!v.image, {
		error: 'image is required when buildSource is "image".',
		path: ["image"],
	});

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const services = await ServiceDTO.list(locals.user.id);
	return json(services.map((s) => s.toJSON()));
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const result = createServiceBody.safeParse(body);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const input = result.data;

	if (await ServiceDTO.slugTaken(input.slug)) {
		return json({ error: "That slug is already in use." }, { status: 409 });
	}

	const projectId =
		input.projectId && (await ProjectDTO.get(input.projectId, locals.user.id))
			? input.projectId
			: null;

	const svc = await ServiceDTO.create({
		containerPort: input.containerPort,
		cpuLimit: input.cpuLimit || null,
		dnsResolvable: input.dnsResolvable,
		envVars: input.envVars,
		image: input.image ?? "",
		memoryLimitMb: input.memoryLimitMb ?? null,
		name: input.name,
		projectId,
		registryPasswordEnc: input.registryPassword
			? encryptSecret(input.registryPassword)
			: null,
		registryUrl: input.registryUrl || null,
		registryUsername: input.registryUsername || null,
		restartPolicy: input.restartPolicy,
		slug: input.slug,
		tag: input.tag ?? "",
		userId: locals.user.id,
	});

	logger.info(
		`Service created via API: service=${svc.id} slug=${svc.slug} user=${locals.user.id}`,
	);

	return json(svc.toJSON(), { status: 201 });
};
