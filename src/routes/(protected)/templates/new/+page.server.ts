import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { TemplateDTO } from "$lib/dto/template-dto";
import { TemplateLinkDTO } from "$lib/dto/template-link-dto";
import { Logger } from "$lib/logger";
import { parseEnvVars } from "$lib/server/validation/service";
import { createTemplateSchema } from "$lib/server/validation/template";
import { slugify } from "$lib/services/template-links";

const logger = new Logger("Templates");

export const load = async ({ parent }) => {
	const { user } = await parent();

	const templates = await TemplateDTO.listForUser(user.id);
	const linkCounts = await Promise.all(
		templates.map((t) => TemplateLinkDTO.countForTemplate(t.id)),
	);
	const linkable = templates
		.filter((_, i) => linkCounts[i] === 0)
		.map((t) => t.toJSON());

	return { linkableTemplates: linkable };
};

async function createLinks(
	newTemplateId: string,
	formData: FormData,
	userId: string,
) {
	const linkTemplateIds = formData.getAll("linkTemplateId").map(String);
	const linkEnabledFlags = formData.getAll("linkEnabled").map(String);

	const rows: { alias: string; linkedTemplateId: string }[] = [];
	const seenAliases = new Set<string>();
	for (let i = 0; i < linkTemplateIds.length; i += 1) {
		if (linkEnabledFlags[i] !== "true") {
			continue;
		}
		const linkedTemplateId = linkTemplateIds[i];
		// biome-ignore lint/performance/noAwaitInLoops: a handful of link rows at most, validates in order to fail on the first bad one
		const linked = await TemplateDTO.usable(linkedTemplateId, userId);
		if (!linked) {
			return "One of the linked containers wasn't found.";
		}
		if ((await TemplateLinkDTO.countForTemplate(linkedTemplateId)) > 0) {
			return `"${linked.name}" already links to other containers itself, and can't be linked to in turn.`;
		}
		const rawAlias = formData.get(`linkAlias.${linkedTemplateId}`);
		const alias =
			(rawAlias ? String(rawAlias) : "").trim() || slugify(linked.name);
		if (seenAliases.has(alias)) {
			return `The alias "${alias}" is used more than once.`;
		}
		seenAliases.add(alias);
		rows.push({ alias, linkedTemplateId });
	}

	for (const row of rows) {
		// biome-ignore lint/performance/noAwaitInLoops: a handful of link rows at most, no benefit to parallelizing
		await TemplateLinkDTO.create({
			alias: row.alias,
			linkedTemplateId: row.linkedTemplateId,
			templateId: newTemplateId,
		});
	}
	return null;
}

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = createTemplateSchema.safeParse(Object.fromEntries(formData));

		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}

		const input = result.data;

		const newTemplate = await TemplateDTO.create({
			category: input.category || null,
			containerPort: input.containerPort,
			cpuLimit: input.cpuLimit || null,
			description: input.description || null,
			envVars: parseEnvVars(formData),
			icon: input.icon || null,
			image: input.image,
			memoryLimitMb: input.memoryLimitMb ?? null,
			name: input.name,
			ownerId: locals.user.id,
			restartPolicy: input.restartPolicy,
			tag: input.tag,
		});

		const linkError = await createLinks(
			newTemplate.id,
			formData,
			locals.user.id,
		);
		if (linkError) {
			return fail(400, { error: linkError });
		}

		logger.info(`Template created: name=${input.name} user=${locals.user.id}`);
		redirect(303, resolve("/templates"));
	},
};
