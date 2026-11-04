import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { Logger } from "#lib/logger.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import {
	RemoteHostSettingsError,
	RemoteHostSettingsService,
} from "#lib/services/remote-host-settings.service.js";

const logger = new Logger("RemoteHosts");

export const load = async ({ parent }) => {
	await parent();
	const settings = await InstanceSettingsDTO.get();
	return { buildConcurrency: settings.buildConcurrency };
};

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const host = await RemoteHostDTO.get(params.hostId);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}
		await RemoteHostSettingsService.remove(host);
		logger.info(`Remote host deleted: host=${host.id} user=${locals.user.id}`);
		throw redirect(302, resolve("remote-hosts"));
	},

	updateBuilds: async ({ request, params, locals }) => {
		if (!locals.user) {
			return redirectToSignIn();
		}
		const host = await RemoteHostDTO.get(params.hostId);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}
		const value = String(
			(await request.formData()).get("maxConcurrentBuilds") ?? "",
		).trim();
		try {
			await RemoteHostSettingsService.update(host, {
				maxConcurrentBuilds: value === "" ? null : Number(value),
			});
		} catch (err) {
			if (err instanceof RemoteHostSettingsError) {
				return fail(400, { error: err.message });
			}
			throw err;
		}
		return { success: true };
	},

	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const host = await RemoteHostDTO.get(params.hostId);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}
		const formData = await request.formData();
		const field = (key: string) => formData.get(key) as string | null;
		try {
			await RemoteHostSettingsService.update(host, {
				agentToken: field("agentToken"),
				agentUrl: field("agentUrl") ?? "",
				dockerHost: field("dockerHost") ?? "",
				name: field("name") ?? "",
				tlsCa: field("tlsCa"),
				tlsCert: field("tlsCert"),
				tlsKey: field("tlsKey"),
			});
		} catch (err) {
			if (err instanceof RemoteHostSettingsError) {
				return fail(400, { error: err.message });
			}
			throw err;
		}
		return { success: true };
	},
};
