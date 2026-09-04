import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { quickDeployFromTemplate } from "$lib/services/template-links";

export const load = async ({ parent, url }) => {
	const { user } = await parent();

	const templates = await TemplateDTO.listForUser(user.id);
	const links = await Promise.all(
		templates.map((t) => TemplateLinkDTO.listForTemplate(t.id)),
	);
	const linkedNamesById = new Map(
		templates.map((t, i) => [t.id, links[i].map((l) => l.linkedTemplateName)]),
	);

	const rawProjectId = url.searchParams.get("projectId");
	const project = rawProjectId
		? await ProjectDTO.get(rawProjectId, user.id)
		: null;

	const withLinks = (t: TemplateDTO) => ({
		...t.toJSON(),
		linkedNames: linkedNamesById.get(t.id) ?? [],
	});

	return {
		builtins: templates.filter((t) => t.isBuiltin).map(withLinks),
		mine: templates.filter((t) => !t.isBuiltin).map(withLinks),
		project: project?.toJSON() ?? null,
	};
};

export const actions = {
	quickDeploy: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const templateId = formData.get("templateId") as string | null;
		const rawProjectId = formData.get("projectId") as string | null;
		if (!templateId) {
			return fail(400, { error: "Missing template." });
		}
		const projectId =
			rawProjectId && (await ProjectDTO.get(rawProjectId, locals.user.id))
				? rawProjectId
				: null;

		const result = await quickDeployFromTemplate(
			templateId,
			locals.user.id,
			projectId,
		);
		if (!result.ok) {
			return fail(result.status, { error: result.error });
		}

		return {
			href: result.projectId
				? `${resolve("/projects")}/${result.projectId}`
				: `${resolve("/services")}/${result.serviceId}`,
			serviceId: result.serviceId,
		};
	},
};
