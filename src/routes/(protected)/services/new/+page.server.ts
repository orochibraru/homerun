import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { Logger } from "$lib/logger";
import {
	type CreateServiceInput,
	createServiceSchema,
	parseEnvVars,
} from "$lib/server/validation/service";
import { DeploymentService } from "$lib/services/deploy.service";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import { encryptSecret } from "$lib/services/secrets";
import {
	buildTemplateLinkContext,
	createLinkedServices,
	createStackForLinkedServices,
	resolveEnvVarsWithLinks,
	templateHostAccessRefusal,
} from "$lib/services/template-links";

const logger = new Logger("Services");

function buildSourceFields(input: CreateServiceInput, slug: string) {
	if (input.buildSource !== "git") {
		return {
			autoDeployOnPush: false,
			gitBakeFile: null,
			gitBakeTarget: null,
			gitBuildContext: null,
			gitBuildMethod: "dockerfile" as const,
			gitDockerfilePath: null,
			gitProviderId: null,
			gitRef: null,
			gitRepo: null,
			gitUrl: null,
			image: input.image as string,
			tag: input.tag || "latest",
		};
	}
	return {
		autoDeployOnPush: input.autoDeployOnPush,
		gitBakeFile: input.gitBakeFile || null,
		gitBakeTarget: input.gitBakeTarget || null,
		gitBuildContext: input.gitBuildContext || null,
		gitBuildMethod: input.gitBuildMethod,
		gitDockerfilePath: input.gitDockerfilePath || null,
		gitProviderId: (input.gitRepo && input.gitProviderId) || null,
		gitRef: input.gitRef || null,
		gitRepo: (input.gitProviderId && input.gitRepo) || null,
		gitUrl: input.gitUrl || null,
		image: `homerun-build-${slug}`,
		tag: "pending",
	};
}

export const load = async ({ url, parent, locals }) => {
	const { user } = await parent();
	const stackId = url.searchParams.get("stackId");
	const templateId = url.searchParams.get("templateId");

	const stack = stackId && (await StackDTO.get(stackId)) ? stackId : null;
	const template = templateId ? await TemplateDTO.get(templateId) : null;
	const [settings, connections, cacheRegistries, templateLinks, existing] =
		await Promise.all([
			InstanceSettingsDTO.get(),
			GitConnectionDTO.listForUser(user.id),
			BuildCacheRegistryDTO.list(),
			template ? TemplateLinkDTO.listForTemplate(template.id) : [],
			ServiceDTO.list(),
		]);
	const providersById = new Map(settings.gitProviders.map((p) => [p.id, p]));

	return {
		baseDomain: config.baseDomain,
		buildCacheRegistries: cacheRegistries.map((r) => r.toJSON()),
		linkableServices: existing.map((svc) => ({
			containerPort: svc.containerPort,
			envVars: svc.envVars ?? {},
			id: svc.id,
			image: svc.image,
			name: svc.name,
			slug: svc.slug,
		})),
		connectedGitProviders: connections
			.filter((c) => providersById.has(c.providerId))
			.map((c) => ({
				id: c.providerId,
				name: providersById.get(c.providerId)?.name ?? c.providerKind,
				providerUsername: c.providerUsername,
			})),
		stackId: stack,
		template: template?.toJSON() ?? null,
		templateHostAccessRefusal:
			template && !locals.isAdmin
				? templateHostAccessRefusal(
						template,
						templateLinks.map((l) => ({
							runtime: l.linkedTemplateRuntime,
							templateName: l.linkedTemplateName,
						})),
						false,
					)
				: null,
		templateLinks: templateLinks.map((l) => ({
			alias: l.link.alias,
			icon: l.linkedTemplateIcon,
			name: l.linkedTemplateName,
		})),
	};
};

async function prepareLinkedStack(
	formData: FormData,
	user: { id: string; isAdmin: boolean },
	primary: { name: string; stackId: string | null; slug: string },
) {
	const userId = user.id;
	const templateId = (formData.get("templateId") as string | null) || null;
	const template = templateId ? await TemplateDTO.get(templateId) : null;
	const links = template
		? await buildTemplateLinkContext(template.id, primary.slug)
		: [];
	const refusal = template
		? templateHostAccessRefusal(template, links, user.isAdmin)
		: null;
	if (refusal) {
		return {
			failure: fail(403, {
				error: refusal,
				values: Object.fromEntries(formData),
			}),
		} as const;
	}

	const stackId =
		links.length > 0 && !primary.stackId
			? await createStackForLinkedServices(primary.name, userId)
			: primary.stackId;

	return { links, stackId, template };
}

async function finishLinkedStack(
	links: Awaited<ReturnType<typeof buildTemplateLinkContext>>,
	stackId: string | null,
	userId: string,
	primaryServiceId: string,
): Promise<ServiceDTO[]> {
	if (links.length === 0 || !stackId) {
		return [];
	}
	const linkedServices = await createLinkedServices(links, {
		stackId,
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
		});
	}
	return linkedServices;
}

/** The two uniqueness checks a new service can fail on, as one guard. */
async function takenFieldFailure(
	input: { domain?: string; slug: string },
	formData: FormData,
) {
	const errors: Record<string, string[]> = {};
	if (await ServiceDTO.slugTaken(input.slug)) {
		errors.slug = ["That slug is already in use."];
	}
	if (input.domain && (await ServiceDTO.domainTaken([input.domain]))) {
		errors.domain = ["That domain is already in use."];
	}
	if (Object.keys(errors).length === 0) {
		return null;
	}
	return {
		failure: fail(400, { errors, values: Object.fromEntries(formData) }),
	} as const;
}

/** Logs and notifies a service the wizard just created. */
function announceCreated(
	svc: ServiceDTO,
	input: CreateServiceInput,
	userId: string,
) {
	logger.info(
		`Service created: service=${svc.id} slug=${input.slug} source=${input.buildSource} user=${userId}`,
	);
	NotificationDTO.notify({
		message: `"${svc.name}" was created.`,
		serviceId: svc.id,
		type: "service_created",
	});
}

async function createServiceFromForm(
	formData: FormData,
	user: { id: string; isAdmin: boolean },
) {
	const userId = user.id;
	const rawStackId = formData.get("stackId") as string | null;
	const initialStackId =
		rawStackId && (await StackDTO.get(rawStackId)) ? rawStackId : null;

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

	const taken = await takenFieldFailure(input, formData);
	if (taken) {
		return taken;
	}

	const prepared = await prepareLinkedStack(formData, user, {
		name: input.name,
		stackId: initialStackId,
		slug: input.slug,
	});
	if ("failure" in prepared) {
		return { failure: prepared.failure } as const;
	}
	const { links, stackId, template } = prepared;

	const envVars =
		links.length > 0
			? resolveEnvVarsWithLinks(parseEnvVars(formData), links)
			: parseEnvVars(formData);

	const svc = await ServiceDTO.create({
		authRequired: input.authRequired,
		domains: input.domain ? [input.domain] : [],
		networkMode: input.networkMode,
		portProtocol: input.portProtocol,
		buildCacheRegistryId:
			input.buildSource === "git" ? input.buildCacheRegistryId || null : null,
		buildSource: input.buildSource,
		containerPort: input.containerPort,
		cpuLimit: input.cpuLimit || null,
		dnsResolvable: input.dnsResolvable,
		envVars,
		healthcheckCommand:
			input.healthcheckCommand || template?.healthcheckCommand || null,
		memoryLimitMb: input.memoryLimitMb ?? null,
		name: input.name,
		stackId,
		registryPasswordEnc: input.registryPassword
			? encryptSecret(input.registryPassword)
			: null,
		registryUrl: input.registryUrl || null,
		registryUsername: input.registryUsername || null,
		restartPolicy: input.restartPolicy,
		runtime: template?.runtimeOptions,
		slug: input.slug,
		userId,
		...buildSourceFields(input, input.slug),
	});

	await GitWebhookService.sync(svc, {
		gitProviderId: null,
		gitRepo: null,
		gitWebhookId: null,
	});

	announceCreated(svc, input, userId);

	const linkedServices = await finishLinkedStack(
		links,
		stackId,
		userId,
		svc.id,
	);

	return { linkedServices, stackId, svc } as const;
}

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = await createServiceFromForm(formData, {
			id: locals.user.id,
			isAdmin: locals.isAdmin,
		});
		if ("failure" in result) {
			return result.failure;
		}

		redirect(
			303,
			result.stackId && result.linkedServices.length > 0
				? `${resolve("/stacks")}/${result.stackId}`
				: `${resolve("/services")}/${result.svc.id}`,
		);
	},

	createAndDeploy: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = await createServiceFromForm(formData, {
			id: locals.user.id,
			isAdmin: locals.isAdmin,
		});
		if ("failure" in result) {
			return result.failure;
		}

		await DeploymentService.enqueueStackDeploy(
			result.svc,
			result.linkedServices,
			locals.user.id,
		);

		redirect(
			303,
			result.stackId && result.linkedServices.length > 0
				? `${resolve("/stacks")}/${result.stackId}`
				: `${resolve("/services")}/${result.svc.id}`,
		);
	},
};
