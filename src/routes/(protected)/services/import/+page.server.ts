import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import {
	ComposeParseError,
	type ComposeServiceDraft,
	parseComposeFile,
} from "$lib/compose-import";
import { StackDTO } from "$lib/dto/stack-dto";
import { HOST_ACCESS_MESSAGE, hostAccessRequested } from "$lib/host-access";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { ComposeImportService } from "$lib/services/compose-import.service";

const logger = new Logger("ComposeImport");

export const load = async ({ url, parent }) => {
	await parent();
	const stacks = await StackDTO.list();
	return {
		stackId: url.searchParams.get("stackId"),
		stacks: stacks.map((p) => p.toJSON()),
	};
};

function planFrom(compose: string, envFiles: Record<string, string> = {}) {
	try {
		return { plan: parseComposeFile(compose, { envFiles }) } as const;
	} catch (err) {
		return {
			error:
				err instanceof ComposeParseError
					? err.message
					: "Couldn't parse that compose file.",
		} as const;
	}
}

function envFilesFrom(formData: FormData): Record<string, string> {
	const paths = formData.getAll("envFilePath").map(String);
	const contents = formData.getAll("envFileContent").map(String);
	return Object.fromEntries(
		paths.flatMap((path, index) =>
			contents[index]?.trim() ? [[path, contents[index]]] : [],
		),
	);
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
		const parsed = planFrom(compose, envFilesFrom(formData));
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

		if (!locals.isAdmin && drafts.some((draft) => hostAccessRequested(draft))) {
			return fail(403, {
				compose,
				error: HOST_ACCESS_MESSAGE,
				plan: parsed.plan,
			});
		}

		const stackId = (formData.get("stackId") as string | null) || null;
		const stackName =
			(formData.get("stackName") as string | null)?.trim() || null;

		const result = await ComposeImportService.importPlan({
			allowHostAccess: locals.isAdmin,
			drafts,
			stackId,
			stackName: stackId ? null : stackName,
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
			result.stackId
				? `${resolve("/stacks")}/${result.stackId}`
				: resolve("/services"),
		);
	},
};
