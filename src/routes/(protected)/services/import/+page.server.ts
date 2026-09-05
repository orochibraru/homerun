import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import {
	ComposeParseError,
	type ComposeServiceDraft,
	parseComposeFile,
} from "$lib/compose-import";
import { ProjectDTO } from "$lib/dto/project-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { ComposeImportService } from "$lib/services/compose-import.service";

const logger = new Logger("ComposeImport");

export const load = async ({ url, parent }) => {
	const { user } = await parent();
	const projects = await ProjectDTO.list(user.id);
	return {
		projectId: url.searchParams.get("projectId"),
		projects: projects.map((p) => p.toJSON()),
	};
};

function planFrom(compose: string) {
	try {
		return { plan: parseComposeFile(compose) } as const;
	} catch (err) {
		return {
			error:
				err instanceof ComposeParseError
					? err.message
					: "Couldn't parse that compose file.",
		} as const;
	}
}

function pickSelected(
	drafts: ComposeServiceDraft[],
	selected: string[],
): ComposeServiceDraft[] {
	if (selected.length === 0) {
		return drafts;
	}
	const keys = new Set(selected);
	return drafts.filter((draft) => keys.has(draft.key));
}

export const actions = {
	preview: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const compose = (formData.get("compose") as string | null) ?? "";
		if (!compose.trim()) {
			return fail(400, { error: "Paste a compose file first." });
		}

		const parsed = planFrom(compose);
		if ("error" in parsed) {
			return fail(400, { compose, error: parsed.error });
		}
		return { compose, plan: parsed.plan };
	},

	import: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const compose = (formData.get("compose") as string | null) ?? "";
		const parsed = planFrom(compose);
		if ("error" in parsed) {
			return fail(400, { compose, error: parsed.error });
		}

		const drafts = pickSelected(
			parsed.plan.services,
			formData.getAll("serviceKey").map(String),
		);
		if (drafts.length === 0) {
			return fail(400, {
				compose,
				error: "Pick at least one service to import.",
				plan: parsed.plan,
			});
		}

		const projectId = (formData.get("projectId") as string | null) || null;
		const projectName =
			(formData.get("projectName") as string | null)?.trim() || null;

		const result = await ComposeImportService.importPlan({
			drafts,
			projectId,
			projectName: projectId ? null : projectName,
			userId: locals.user.id,
		});

		if (formData.get("deploy") === "on") {
			await ComposeImportService.deployImported(
				result.services,
				locals.user.id,
			);
		}

		logger.info(
			`Compose import finished: services=${result.services.length} user=${locals.user.id}`,
		);
		redirect(
			303,
			result.projectId
				? `${resolve("/projects")}/${result.projectId}`
				: resolve("/services"),
		);
	},
};
