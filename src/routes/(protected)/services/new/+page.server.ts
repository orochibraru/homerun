import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import {
	type CreateServiceInput,
	createServiceSchema,
	parseEnvVars,
} from "$lib/server/validation/service";
import { DeploymentService } from "$lib/services/deploy.service";
import { encryptSecret } from "$lib/services/secrets";
import {
	buildTemplateLinkContext,
	createLinkedServices,
	createProjectForLinkedStack,
	resolveEnvVarsWithLinks,
} from "$lib/services/template-links";

const logger = new Logger("Services");

function buildSourceFields(input: CreateServiceInput, slug: string) {
	if (input.buildSource !== "git") {
		return {
			gitBuildContext: null,
			gitDockerfilePath: null,
			gitRef: null,
			gitUrl: null,
			image: input.image as string,
			tag: input.tag || "latest",
		};
	}
	return {
		gitBuildContext: input.gitBuildContext || null,
		gitDockerfilePath: input.gitDockerfilePath || null,
		gitRef: input.gitRef || null,
		gitUrl: input.gitUrl || null,
		image: `homerun-build-${slug}`,
		tag: "pending",
	};
}

export const load = async ({ url, parent }) => {
	const { user } = await parent();
	const projectId = url.searchParams.get("projectId");
	const templateId = url.searchParams.get("templateId");

	const project =
		projectId && (await ProjectDTO.get(projectId, user.id)) ? projectId : null;
	const template = templateId
		? await TemplateDTO.usable(templateId, user.id)
		: null;
	const [settings, connections, cacheRegistries, templateLinks] =
		await Promise.all([
			InstanceSettingsDTO.get(),
			GitConnectionDTO.listForUser(user.id),
			BuildCacheRegistryDTO.list(user.id),
			template ? TemplateLinkDTO.listForTemplate(template.id) : [],
		]);
	const providersById = new Map(settings.gitProviders.map((p) => [p.id, p]));

	return {
		baseDomain: config.baseDomain,
		buildCacheRegistries: cacheRegistries.map((r) => r.toJSON()),
		connectedGitProviders: connections
			.filter((c) => providersById.has(c.providerId))
			.map((c) => ({
				id: c.providerId,
				name: providersById.get(c.providerId)?.name ?? c.providerKind,
				providerUsername: c.providerUsername,
			})),
		projectId: project,
		template: template?.toJSON() ?? null,
		templateLinks: templateLinks.map((l) => ({
			alias: l.link.alias,
			icon: l.linkedTemplateIcon,
			name: l.linkedTemplateName,
		})),
	};
};

async function prepareLinkedStack(
	formData: FormData,
	userId: string,
	primary: { name: string; projectId: string | null; slug: string },
) {
	const templateId = (formData.get("templateId") as string | null) || null;
	const template = templateId
		? await TemplateDTO.usable(templateId, userId)
		: null;
	const links = template
		? await buildTemplateLinkContext(template.id, primary.slug)
		: [];

	const projectId =
		links.length > 0 && !primary.projectId
			? await createProjectForLinkedStack(primary.name, userId)
			: primary.projectId;

	return { links, projectId };
}

async function finishLinkedStack(
	links: Awaited<ReturnType<typeof buildTemplateLinkContext>>,
	projectId: string | null,
	userId: string,
	primaryServiceId: string,
): Promise<ServiceDTO[]> {
	if (links.length === 0 || !projectId) {
		return [];
	}
	const linkedServices = await createLinkedServices(links, {
		projectId,
		remoteHostId: null,
		userId,
	});
	logger.info(
		`Linked services created: primary=${primaryServiceId} count=${linkedServices.length} user=${userId}`,
	);
	for (const linked of linkedServices) {
		NotificationDTO.notify({
			message: `"${linked.name}" was created.`,
			serviceId: linked.id,
			type: "service_created",
			userId,
		});
	}
	return linkedServices;
}

async function createServiceFromForm(formData: FormData, userId: string) {
	const rawProjectId = formData.get("projectId") as string | null;
	const initialProjectId =
		rawProjectId && (await ProjectDTO.get(rawProjectId, userId))
			? rawProjectId
			: null;

	const result = createServiceSchema.safeParse(Object.fromEntries(formData));

	if (!result.success) {
		return {
			failure: fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			}),
		} as const;
	}

	const input = result.data;

	if (await ServiceDTO.slugTaken(input.slug)) {
		return {
			failure: fail(400, {
				errors: { slug: ["That slug is already in use."] },
				values: Object.fromEntries(formData),
			}),
		} as const;
	}

	const { links, projectId } = await prepareLinkedStack(formData, userId, {
		name: input.name,
		projectId: initialProjectId,
		slug: input.slug,
	});

	const envVars =
		links.length > 0
			? resolveEnvVarsWithLinks(parseEnvVars(formData), links)
			: parseEnvVars(formData);

	const svc = await ServiceDTO.create({
		authRequired: input.authRequired,
		buildCacheRegistryId:
			input.buildSource === "git" ? input.buildCacheRegistryId || null : null,
		buildSource: input.buildSource,
		containerPort: input.containerPort,
		cpuLimit: input.cpuLimit || null,
		dnsResolvable: input.dnsResolvable,
		envVars,
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
		userId,
		...buildSourceFields(input, input.slug),
	});

	logger.info(
		`Service created: service=${svc.id} slug=${input.slug} source=${input.buildSource} user=${userId}`,
	);
	NotificationDTO.notify({
		message: `"${svc.name}" was created.`,
		serviceId: svc.id,
		type: "service_created",
		userId,
	});

	const linkedServices = await finishLinkedStack(
		links,
		projectId,
		userId,
		svc.id,
	);

	return { linkedServices, projectId, svc } as const;
}

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = await createServiceFromForm(formData, locals.user.id);
		if ("failure" in result) {
			return result.failure;
		}

		redirect(
			303,
			result.projectId
				? `${resolve("/projects")}/${result.projectId}`
				: resolve("/services"),
		);
	},

	createAndDeploy: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = await createServiceFromForm(formData, locals.user.id);
		if ("failure" in result) {
			return result.failure;
		}

		for (const linked of result.linkedServices) {
			// biome-ignore lint/performance/noAwaitInLoops: linked services (e.g. a database) should be up before the primary service that depends on them starts
			const linkedResult = await DeploymentService.deployService(
				linked,
				locals.user.id,
			);
			if (!linkedResult.success) {
				return fail(500, {
					error: `Service created, but deploying "${linked.name}" failed: ${linkedResult.error ?? "unknown error"}. Find it on the Services page to retry.`,
				});
			}
		}

		const deployResult = await DeploymentService.deployService(
			result.svc,
			locals.user.id,
		);
		if (!deployResult.success) {
			return fail(500, {
				error: `Service created, but the deploy failed: ${deployResult.error ?? "unknown error"}. Find it on the Services page to retry.`,
			});
		}

		redirect(
			303,
			result.projectId && result.linkedServices.length > 0
				? `${resolve("/projects")}/${result.projectId}`
				: `${resolve("/services")}/${result.svc.id}`,
		);
	},
};
