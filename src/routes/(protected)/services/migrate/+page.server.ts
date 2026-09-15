import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import {
	type DokployEntry,
	type DokployPlanItem,
	DokployService,
} from "$lib/services/dokploy.service";

const logger = new Logger("Dokploy");

async function takenSlugs(userId: string): Promise<Set<string>> {
	const services = await ServiceDTO.list(userId);
	return new Set(services.map((svc) => svc.slug));
}

export const actions = {
	dryRun: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const baseUrl = (formData.get("baseUrl") as string | null)?.trim() ?? "";
		const token = (formData.get("token") as string | null)?.trim() ?? "";
		if (!(baseUrl && token)) {
			return fail(400, {
				error: "Both the Dokploy URL and a token are needed.",
			});
		}
		if (!URL.canParse(baseUrl)) {
			return fail(400, {
				error:
					'Dokploy URL must be a full URL, like "https://dokploy.example.com".',
			});
		}

		try {
			const entries = await DokployService.listEntries({ baseUrl, token });
			const plan = DokployService.plan(
				entries,
				await takenSlugs(locals.user.id),
			);
			logger.info(
				`Dokploy dry run: entries=${entries.length} user=${locals.user.id}`,
			);
			return { baseUrl, plan, values: { baseUrl } };
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
				values: { baseUrl },
			});
		}
	},

	import: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const raw = formData.get("items") as string | null;
		if (!raw) {
			return fail(400, { error: "Nothing picked to import." });
		}

		let items: DokployPlanItem[];
		try {
			items = JSON.parse(raw) as DokployPlanItem[];
		} catch {
			return fail(400, { error: "That selection couldn't be read." });
		}
		const importable = items.filter(
			(item): item is DokployPlanItem & { entry: DokployEntry } =>
				!!item?.entry && !item.blocked,
		);
		if (importable.length === 0) {
			return fail(400, { error: "Nothing in that selection can be imported." });
		}

		const result = await DokployService.importPlan(importable, locals.user.id);
		return { result, success: true };
	},
};
