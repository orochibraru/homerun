import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StackDTO } from "$lib/dto/stack-dto";
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

	const rawStackId = url.searchParams.get("stackId");
	const [builtins, mine, categories, stack] = await Promise.all([
		TemplateDTO.listPaged(user.id, "builtin", builtinQuery),
		TemplateDTO.listPaged(user.id, "mine", mineQuery),
		TemplateDTO.listCategories(user.id),
		rawStackId ? StackDTO.get(rawStackId, user.id) : null,
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
		stack: stack?.toJSON() ?? null,
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
		const rawStackId = formData.get("stackId") as string | null;
		if (!templateId) {
			return fail(400, { error: "Missing template." });
		}
		const stackId =
			rawStackId && (await StackDTO.get(rawStackId, locals.user.id))
				? rawStackId
				: null;

		const result = await quickDeployFromTemplate(
			templateId,
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
