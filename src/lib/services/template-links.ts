import { NotificationDTO } from "$lib/dto/notification-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { Logger } from "$lib/logger";
import { DeploymentService } from "./deploy.service";

const logger = new Logger("Templates");

export interface ResolvedTemplateLink {
	alias: string;
	containerPort: number;
	cpuLimit: string | null;
	envVars: Record<string, string>;
	image: string;
	memoryLimitMb: number | null;
	restartPolicy: string;
	slug: string;
	tag: string;
	templateName: string;
}

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
}

export function resolveLinkTokens(
	value: string,
	context: Record<string, { envVars: Record<string, string>; slug: string }>,
): string {
	return value.replace(
		/\{\{([\w-]+)(?:\.([\w-]+))?\}\}/g,
		(match, alias, key) => {
			const linked = context[alias];
			if (!linked) {
				return match;
			}
			if (!key) {
				return linked.slug;
			}
			return linked.envVars[key] ?? match;
		},
	);
}

async function uniqueLinkSlug(baseSlug: string): Promise<string> {
	let candidate = baseSlug;
	let suffix = 1;
	// biome-ignore lint/performance/noAwaitInLoops: retry loop, each check depends on the previous candidate being rejected
	while (await ServiceDTO.slugTaken(candidate)) {
		suffix += 1;
		candidate = slugify(`${baseSlug}-${suffix}`);
	}
	return candidate;
}

export async function buildTemplateLinkContext(
	templateId: string,
	primarySlug: string,
): Promise<ResolvedTemplateLink[]> {
	const links = await TemplateLinkDTO.listForTemplate(templateId);
	const resolved: ResolvedTemplateLink[] = [];
	for (const { link, ...linkedTemplate } of links) {
		// biome-ignore lint/performance/noAwaitInLoops: each slug must account for the ones already picked earlier in this same batch, none of which are committed to the DB yet
		const slug = await uniqueLinkSlug(slugify(`${primarySlug}-${link.alias}`));
		resolved.push({
			alias: link.alias,
			containerPort: linkedTemplate.linkedTemplateContainerPort,
			cpuLimit: linkedTemplate.linkedTemplateCpuLimit,
			envVars: linkedTemplate.linkedTemplateEnvVars,
			image: linkedTemplate.linkedTemplateImage,
			memoryLimitMb: linkedTemplate.linkedTemplateMemoryLimitMb,
			restartPolicy: linkedTemplate.linkedTemplateRestartPolicy,
			slug,
			tag: linkedTemplate.linkedTemplateTag,
			templateName: linkedTemplate.linkedTemplateName,
		});
	}
	return resolved;
}

export function resolveEnvVarsWithLinks(
	envVars: Record<string, string>,
	links: ResolvedTemplateLink[],
): Record<string, string> {
	const context = Object.fromEntries(
		links.map((l) => [l.alias, { envVars: l.envVars, slug: l.slug }]),
	);
	return Object.fromEntries(
		Object.entries(envVars).map(([key, value]) => [
			key,
			resolveLinkTokens(value, context),
		]),
	);
}

async function uniqueProjectSlug(baseSlug: string): Promise<string> {
	let candidate = baseSlug;
	let suffix = 1;
	// biome-ignore lint/performance/noAwaitInLoops: retry loop, each check depends on the previous candidate being rejected
	while (await ProjectDTO.slugTaken(candidate)) {
		suffix += 1;
		candidate = slugify(`${baseSlug}-${suffix}`);
	}
	return candidate;
}

export async function createProjectForLinkedStack(
	name: string,
	userId: string,
): Promise<string> {
	const slug = await uniqueProjectSlug(slugify(name));
	const project = await ProjectDTO.create({ name, slug, userId });
	return project.id;
}

export async function createLinkedServices(
	links: ResolvedTemplateLink[],
	params: { projectId: string; remoteHostId: string | null; userId: string },
): Promise<ServiceDTO[]> {
	const created: ServiceDTO[] = [];
	for (const link of links) {
		// biome-ignore lint/performance/noAwaitInLoops: services are created one at a time so each gets a fresh slug-uniqueness check against the ones already committed
		const svc = await ServiceDTO.create({
			containerPort: link.containerPort,
			cpuLimit: link.cpuLimit,
			dnsResolvable: false,
			envVars: link.envVars,
			memoryLimitMb: link.memoryLimitMb,
			name: link.templateName,
			projectId: params.projectId,
			remoteHostId: params.remoteHostId,
			restartPolicy: link.restartPolicy,
			slug: link.slug,
			tag: link.tag,
			userId: params.userId,
			image: link.image,
		});
		created.push(svc);
	}
	return created;
}

async function uniqueServiceSlug(baseSlug: string): Promise<string> {
	let candidate = baseSlug;
	let suffix = 1;
	// biome-ignore lint/performance/noAwaitInLoops: retry loop, each check depends on the previous candidate being rejected
	while (await ServiceDTO.slugTaken(candidate)) {
		suffix += 1;
		candidate = slugify(`${baseSlug}-${suffix}`);
	}
	return candidate;
}

export async function createServiceFromTemplate(
	template: TemplateDTO,
	userId: string,
	projectId: string | null,
): Promise<{
	linkedServices: ServiceDTO[];
	projectId: string | null;
	svc: ServiceDTO;
}> {
	const row = template.toJSON();
	const slug = await uniqueServiceSlug(slugify(row.name));
	const links = await buildTemplateLinkContext(row.id, slug);

	const finalProjectId =
		links.length > 0 && !projectId
			? await createProjectForLinkedStack(row.name, userId)
			: projectId;

	const envVars =
		links.length > 0
			? resolveEnvVarsWithLinks(row.envVars ?? {}, links)
			: (row.envVars ?? {});

	const svc = await ServiceDTO.create({
		containerPort: row.containerPort,
		cpuLimit: row.cpuLimit,
		envVars,
		image: row.image,
		memoryLimitMb: row.memoryLimitMb,
		name: row.name,
		projectId: finalProjectId,
		restartPolicy: row.restartPolicy,
		slug,
		tag: row.tag,
		userId,
	});

	const linkedServices =
		links.length > 0 && finalProjectId
			? await createLinkedServices(links, {
					projectId: finalProjectId,
					remoteHostId: null,
					userId,
				})
			: [];

	return { linkedServices, projectId: finalProjectId, svc };
}

export type QuickDeployResult =
	| { ok: true; projectId: string | null; serviceId: string }
	| { error: string; ok: false; status: number };

export async function quickDeployFromTemplate(
	templateId: string,
	userId: string,
	projectId: string | null,
): Promise<QuickDeployResult> {
	const template = await TemplateDTO.usable(templateId, userId);
	if (!template) {
		return { error: "Template not found.", ok: false, status: 404 };
	}

	const {
		linkedServices,
		projectId: finalProjectId,
		svc,
	} = await createServiceFromTemplate(template, userId, projectId);

	logger.info(
		`Quick-deployed from template: template=${templateId} service=${svc.id} user=${userId}`,
	);
	NotificationDTO.notify({
		message: `"${svc.name}" was created.`,
		serviceId: svc.id,
		type: "service_created",
		userId,
	});

	for (const linked of linkedServices) {
		NotificationDTO.notify({
			message: `"${linked.name}" was created.`,
			serviceId: linked.id,
			type: "service_created",
			userId,
		});
	}

	await DeploymentService.enqueueStackDeploy(svc, linkedServices, userId);

	return {
		ok: true,
		projectId: linkedServices.length > 0 ? finalProjectId : null,
		serviceId: svc.id,
	};
}
