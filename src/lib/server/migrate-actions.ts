import { fail, type RequestEvent, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import type { MigrationConnection, MigrationEntry } from "$lib/migrate/common";
import { allowLongRequest } from "$lib/server/long-request";
import { MigrationService } from "$lib/services/migration.service";

export interface MigrationSource {
	label: string;
	listEntries: (
		connection: MigrationConnection,
		only?: Set<string>,
	) => Promise<MigrationEntry[]>;
}

function guard(event: RequestEvent): string {
	allowLongRequest(event.platform);
	if (!event.locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}
	if (!event.locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	return event.locals.user.id;
}

function readConnection(
	formData: FormData,
	label: string,
): MigrationConnection | string {
	const baseUrl = String(formData.get("baseUrl") ?? "").trim();
	const token = String(formData.get("token") ?? "").trim();
	if (!(baseUrl && token)) {
		return `Both the ${label} URL and an API token are needed.`;
	}
	if (!(URL.canParse(baseUrl) && /^https?:/i.test(baseUrl))) {
		return `${label} URL must be a full URL, like "https://${label.toLowerCase()}.example.com".`;
	}
	return { baseUrl, token };
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function migrationActions(source: MigrationSource) {
	return {
		import: async (event: RequestEvent) => {
			const userId = guard(event);
			const formData = await event.request.formData();
			const connection = readConnection(formData, source.label);
			const baseUrl = String(formData.get("baseUrl") ?? "").trim();
			if (typeof connection === "string") {
				return fail(400, { error: connection, values: { baseUrl } });
			}
			const ids = new Set(formData.getAll("ids").map(String).filter(Boolean));
			if (ids.size === 0) {
				return fail(400, {
					error: "Pick at least one thing to import.",
					values: { baseUrl },
				});
			}
			try {
				const entries = await source.listEntries(connection, ids);
				if (entries.length === 0) {
					return fail(400, {
						error: `None of the picked entries exist on ${source.label} any more : read the instance again.`,
						values: { baseUrl },
					});
				}
				const result = await MigrationService.importEntries(
					entries,
					userId,
					source.label,
				);
				return { result, values: { baseUrl } };
			} catch (err) {
				return fail(400, { error: message(err), values: { baseUrl } });
			}
		},

		preview: async (event: RequestEvent) => {
			const userId = guard(event);
			const formData = await event.request.formData();
			const connection = readConnection(formData, source.label);
			const baseUrl = String(formData.get("baseUrl") ?? "").trim();
			if (typeof connection === "string") {
				return fail(400, { error: connection, values: { baseUrl } });
			}
			try {
				const entries = await source.listEntries(connection);
				const preview = await MigrationService.preview(entries, userId);
				return { preview, values: { baseUrl } };
			} catch (err) {
				return fail(400, { error: message(err), values: { baseUrl } });
			}
		},
	};
}
