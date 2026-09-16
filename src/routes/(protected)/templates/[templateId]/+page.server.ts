import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StackDTO } from "$lib/dto/stack-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { getGitHubRepoInfo } from "$lib/services/github-repo.service";
import { quickDeployFromTemplate } from "$lib/services/template-links";

export const load = async ({ params, parent, url }) => {
	const { user } = await parent();

	const tmpl = await TemplateDTO.usable(params.templateId, user.id);
	if (!tmpl) {
		error(404, "Template not found");
	}

	const links = await TemplateLinkDTO.listForTemplate(tmpl.id);

	const rawStackId = url.searchParams.get("stackId");
	const stack = rawStackId ? await StackDTO.get(rawStackId, user.id) : null;

	const templateJson = tmpl.toJSON();

	return {
		github: getGitHubRepoInfo(templateJson.sourceUrl),
		links: links.map((l) => ({
			alias: l.link.alias,
			icon: l.linkedTemplateIcon,
			image: l.linkedTemplateImage,
			name: l.linkedTemplateName,
			tag: l.linkedTemplateTag,
		})),
		stack: stack?.toJSON() ?? null,
		template: templateJson,
	};
};

export const actions = {
	quickDeploy: async ({ params, request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const rawStackId = formData.get("stackId") as string | null;
		const stackId =
			rawStackId && (await StackDTO.get(rawStackId, locals.user.id))
				? rawStackId
				: null;

		const result = await quickDeployFromTemplate(
			params.templateId,
			locals.user.id,
			stackId,
		);
		if (!result.ok) {
			return fail(result.status, { error: result.error });
		}

		redirect(
			303,
			result.stackId
				? `${resolve("/stacks")}/${result.stackId}`
				: `${resolve("/services")}/${result.serviceId}`,
		);
	},
};
