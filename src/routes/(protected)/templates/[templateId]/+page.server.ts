import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { quickDeployFromTemplate } from "$lib/services/template-links";

export const load = async ({ params, parent, url }) => {
	const { user } = await parent();

	const tmpl = await TemplateDTO.usable(params.templateId, user.id);
	if (!tmpl) {
		error(404, "Template not found");
	}

	const links = await TemplateLinkDTO.listForTemplate(tmpl.id);

	const rawProjectId = url.searchParams.get("projectId");
	const project = rawProjectId
		? await ProjectDTO.get(rawProjectId, user.id)
		: null;

	return {
		links: links.map((l) => ({
			alias: l.link.alias,
			icon: l.linkedTemplateIcon,
			image: l.linkedTemplateImage,
			name: l.linkedTemplateName,
			tag: l.linkedTemplateTag,
		})),
		project: project?.toJSON() ?? null,
		template: tmpl.toJSON(),
	};
};

export const actions = {
	quickDeploy: async ({ params, request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const rawProjectId = formData.get("projectId") as string | null;
		const projectId =
			rawProjectId && (await ProjectDTO.get(rawProjectId, locals.user.id))
				? rawProjectId
				: null;

		const result = await quickDeployFromTemplate(
			params.templateId,
			locals.user.id,
			projectId,
		);
		if (!result.ok) {
			return fail(result.status, { error: result.error });
		}

		redirect(
			303,
			result.projectId
				? `${resolve("/projects")}/${result.projectId}`
				: `${resolve("/services")}/${result.serviceId}`,
		);
	},
};
