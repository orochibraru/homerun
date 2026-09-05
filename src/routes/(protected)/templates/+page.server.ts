import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { parseListQuery } from "$lib/server/list-query";
import { allowLongRequest } from "$lib/server/long-request";
import { quickDeployFromTemplate } from "$lib/services/template-links";

async function withLinkedNames(templates: TemplateDTO[]) {
	const links = await Promise.all(
		templates.map((t) => TemplateLinkDTO.listForTemplate(t.id)),
	);
	return templates.map((t, i) => ({
		...t.toJSON(),
		linkedNames: links[i].map((l) => l.linkedTemplateName),
	}));
}

export const load = async ({ parent, url }) => {
	const { user } = await parent();

	const builtinQuery = parseListQuery(url, {
		filterKeys: ["category"],
		pageParam: "bpage",
		perPage: 24,
	});
	const mineQuery = parseListQuery(url, {
		filterKeys: ["category"],
		pageParam: "mpage",
		perPage: 24,
	});

	const rawProjectId = url.searchParams.get("projectId");
	const [builtins, mine, categories, project] = await Promise.all([
		TemplateDTO.listPaged(user.id, "builtin", builtinQuery),
		TemplateDTO.listPaged(user.id, "mine", mineQuery),
		TemplateDTO.listCategories(user.id),
		rawProjectId ? ProjectDTO.get(rawProjectId, user.id) : null,
	]);

	const [builtinItems, mineItems] = await Promise.all([
		withLinkedNames(builtins.items),
		withLinkedNames(mine.items),
	]);

	return {
		builtins: builtinItems,
		filtered: builtinQuery.active,
		builtinsPage: builtins.page,
		builtinsPerPage: builtins.perPage,
		builtinsTotal: builtins.total,
		categories,
		mine: mineItems,
		minePage: mine.page,
		minePerPage: mine.perPage,
		mineTotal: mine.total,
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
