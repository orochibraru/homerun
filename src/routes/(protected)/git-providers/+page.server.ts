import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import type { GitProviderKind } from "$lib/server/db/schema";

const logger = new Logger("GitProviders");

const VALID_KINDS: GitProviderKind[] = [
	"github",
	"gitlab",
	"gitea",
	"bitbucket",
];

export const load = async ({ parent, locals }) => {
	const { user } = await parent();
	const settings = await InstanceSettingsDTO.get();
	const connections = await GitConnectionDTO.listForUser(user.id);
	const connectedProviderIds = new Set(connections.map((c) => c.providerId));

	return {
		connectedProviderIds: [...connectedProviderIds],
		// Configuring providers (add/delete) is admin-only, same as every
		// other instance-wide config surface — connecting *to* one is not,
		// every developer needs that for their own git-based services.
		isAdmin: locals.isAdmin,
		// clientSecretEnc never leaves the server — the form only ever shows
		// "configured" vs not, same convention as registryPassword/smtpPassword.
		providers: settings.gitProviders.map((p) => ({
			baseUrl: p.baseUrl,
			enabled: p.enabled,
			id: p.id,
			kind: p.kind,
			name: p.name,
		})),
	};
};

export const actions = {
	addProvider: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const kind = formData.get("kind") as string | null;
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const baseUrl = (formData.get("baseUrl") as string | null)?.trim() || null;
		const clientId = (formData.get("clientId") as string | null)?.trim() ?? "";
		const clientSecret =
			(formData.get("clientSecret") as string | null)?.trim() ?? "";

		if (!kind || !VALID_KINDS.includes(kind as GitProviderKind)) {
			return fail(400, { error: "Choose a provider." });
		}
		if (!name) {
			return fail(400, { error: "Name is required." });
		}
		if (!(clientId && clientSecret)) {
			return fail(400, { error: "Client ID and secret are required." });
		}
		if (kind === "gitea" && !baseUrl) {
			return fail(400, {
				error: "Gitea providers need a base URL (self-hosted only).",
			});
		}

		const settings = await InstanceSettingsDTO.get();
		await settings.updateGitProviders([
			...settings.gitProviders.map((p) => ({
				baseUrl: p.baseUrl,
				clientId: p.clientId,
				enabled: p.enabled,
				id: p.id,
				kind: p.kind,
				name: p.name,
			})),
			{
				baseUrl,
				clientId,
				clientSecret,
				enabled: true,
				kind: kind as GitProviderKind,
				name,
			},
		]);

		logger.info(
			`Git provider added: kind=${kind} name=${name} by=${locals.user.id}`,
		);
		return { added: true };
	},

	deleteProvider: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}

		const formData = await request.formData();
		const id = formData.get("id") as string | null;
		if (!id) {
			return fail(400, { error: "Missing provider id." });
		}

		const settings = await InstanceSettingsDTO.get();
		await settings.updateGitProviders(
			settings.gitProviders
				.filter((p) => p.id !== id)
				.map((p) => ({
					baseUrl: p.baseUrl,
					clientId: p.clientId,
					enabled: p.enabled,
					id: p.id,
					kind: p.kind,
					name: p.name,
				})),
		);

		logger.info(`Git provider deleted: id=${id} by=${locals.user.id}`);
		return { deleted: true };
	},

	disconnect: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const providerId = formData.get("providerId") as string | null;
		if (!providerId) {
			return fail(400, { error: "Missing provider id." });
		}

		const connection = await GitConnectionDTO.getForUserAndProvider(
			locals.user.id,
			providerId,
		);
		if (connection) {
			await connection.delete();
			logger.info(
				`Git provider disconnected: provider=${providerId} user=${locals.user.id}`,
			);
		}
		return { disconnected: true };
	},
};
