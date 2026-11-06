import { fail } from "@sveltejs/kit";

import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { Logger } from "#lib/logger.js";
import { APP_VERSION } from "#lib/server/app-version.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { AgentClientService } from "#lib/services/agent-client.service.js";
import { normalizeVersion } from "#lib/services/self-update/version.js";

const logger = new Logger("RemoteHosts");

export const actions = {
	setEnabled: async ({ request, params, locals }) => {
		if (!locals.user) {
			return redirectToSignIn();
		}
		const host = await RemoteHostDTO.get(params.hostId);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}
		const enabled = (await request.formData()).get("enabled") === "true";
		await host.update({ enabled });
		logger.info(
			`Remote host ${enabled ? "enabled" : "disabled"}: host=${host.id} user=${locals.user.id}`,
		);
		return { enabled };
	},

	upgrade: async ({ params, locals }) => {
		if (!locals.user) {
			return redirectToSignIn();
		}
		const host = await RemoteHostDTO.get(params.hostId);
		const connection = host?.toAgentConnection();
		if (!host || !connection) {
			return fail(404, { error: "This host isn't a registered agent." });
		}
		const version = normalizeVersion(APP_VERSION);
		if (!version) {
			return fail(400, {
				error: `This instance runs ${APP_VERSION}, which isn't a release an agent can download.`,
			});
		}
		try {
			const result = await AgentClientService.update(connection, version);
			logger.info(
				`Agent update requested: host=${host.id} from=${result.from} to=${result.version} user=${locals.user.id}`,
			);
			return { version: result.version };
		} catch (err) {
			return fail(502, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	},
};
