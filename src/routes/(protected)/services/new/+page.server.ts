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
import { Logger } from "$lib/logger";
import {
	type CreateServiceInput,
	createServiceSchema,
	parseEnvVars,
} from "$lib/server/validation/service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Services");

/** Maps the validated form input's image-vs-git fields to what ServiceDTO.create expects : pulled out to keep the create action's complexity in check. */
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
		// No real image/tag until the first build : deployService()
		// overwrites both with the resolved local tag once it's built.
		image: `homerun-build-${slug}`,
		tag: "pending",
	};
}

export const load = async ({ url, parent }) => {
	const { user } = await parent();
	const projectId = url.searchParams.get("projectId");
	const templateId = url.searchParams.get("templateId");

	// Ignore a projectId that isn't actually the user's own project, or a
	// templateId the user isn't allowed to use, rather than erroring : the
	// form just falls back to blank/no-project silently safe.
	const project =
		projectId && (await ProjectDTO.get(projectId, user.id)) ? projectId : null;
	const template = templateId
		? await TemplateDTO.usable(templateId, user.id)
		: null;
	const [settings, connections, cacheRegistries] = await Promise.all([
		InstanceSettingsDTO.get(),
		GitConnectionDTO.listForUser(user.id),
		BuildCacheRegistryDTO.list(user.id),
	]);
	const providersById = new Map(settings.gitProviders.map((p) => [p.id, p]));

	return {
		baseDomain: config.baseDomain,
		buildCacheRegistries: cacheRegistries.map((r) => r.toJSON()),
		// Only providers this user has actually connected : see the Git
		// Providers page for connecting one. Same shape as the service
		// Source tab's own "Browse repos" picker, which this form mirrors.
		connectedGitProviders: connections
			.filter((c) => providersById.has(c.providerId))
			.map((c) => ({
				id: c.providerId,
				name: providersById.get(c.providerId)?.name ?? c.providerKind,
				providerUsername: c.providerUsername,
			})),
		projectId: project,
		template: template?.toJSON() ?? null,
	};
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const rawProjectId = formData.get("projectId") as string | null;
		const projectId =
			rawProjectId && (await ProjectDTO.get(rawProjectId, locals.user.id))
				? rawProjectId
				: null;

		const result = createServiceSchema.safeParse(Object.fromEntries(formData));

		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}

		const input = result.data;

		if (await ServiceDTO.slugTaken(input.slug)) {
			return fail(400, {
				errors: { slug: ["That slug is already in use."] },
				values: Object.fromEntries(formData),
			});
		}

		const svc = await ServiceDTO.create({
			authRequired: input.authRequired,
			buildCacheRegistryId:
				input.buildSource === "git" ? input.buildCacheRegistryId || null : null,
			buildSource: input.buildSource,
			containerPort: input.containerPort,
			cpuLimit: input.cpuLimit || null,
			dnsResolvable: input.dnsResolvable,
			envVars: parseEnvVars(formData),
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
			userId: locals.user.id,
			...buildSourceFields(input, input.slug),
		});

		logger.info(
			`Service created: service=${svc.id} slug=${input.slug} source=${input.buildSource} user=${locals.user.id}`,
		);
		NotificationDTO.notify({
			message: `"${svc.name}" was created.`,
			serviceId: svc.id,
			type: "service_created",
			userId: locals.user.id,
		});

		redirect(
			303,
			projectId ? `${resolve("/projects")}/${projectId}` : resolve("/services"),
		);
	},
};
