import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { AgentClientService } from "$lib/services/agent-client.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("RemoteHosts");

export const load = async ({ params, parent }) => {
	const { user } = await parent();
	const host = await RemoteHostDTO.get(params.hostId, user.id);
	if (!host) {
		error(404, "Remote host not found");
	}

	// Same best-effort live health check as the list page (see its own
	// +page.server.ts), just for this one host.
	let agentStatus: {
		reachable: boolean;
		version: string | null;
		error: string | null;
	} | null = null;
	if (host.kind === "agent" && host.agentUrl) {
		try {
			const { version } = await AgentClientService.checkHealth(host.agentUrl);
			agentStatus = { error: null, reachable: true, version };
		} catch (err) {
			agentStatus = {
				error: err instanceof Error ? err.message : String(err),
				reachable: false,
				version: null,
			};
		}
	}

	return { agentStatus, host: host.toJSON() };
};

interface UpdateHostBase {
	isBuildServer: boolean;
	name: string;
}

/**
 * Re-verifies the agent whenever the URL changed or a new token was pasted :
 * the existing connection (URL+token pair) may no longer be valid once
 * either half moves, same check `create` already runs. A blank token means
 * "keep the stored one", same convention as service.registryPasswordEnc.
 */
async function verifyAgentIfChanged(
	host: RemoteHostDTO,
	agentUrl: string,
	agentToken: string,
) {
	const existing = host.toAgentConnection();
	if (!(agentToken || existing?.agentUrl !== agentUrl)) {
		return null;
	}

	const tokenToVerify = agentToken || existing?.token;
	if (!tokenToVerify) {
		return fail(400, { error: "Agent token is required." });
	}
	try {
		await AgentClientService.verifyToken(agentUrl, tokenToVerify);
	} catch (err) {
		return fail(400, {
			error: err instanceof Error ? err.message : "Couldn't verify the agent.",
		});
	}
	return null;
}

/** The `kind: "agent"` branch of the update action. */
async function updateAgentHost(
	host: RemoteHostDTO,
	formData: FormData,
	base: UpdateHostBase,
) {
	const agentUrl = (formData.get("agentUrl") as string | null)?.trim() ?? "";
	const agentToken =
		(formData.get("agentToken") as string | null)?.trim() ?? "";

	if (!agentUrl) {
		return fail(400, { error: "Agent URL is required." });
	}
	if (!URL.canParse(agentUrl)) {
		return fail(400, {
			error: "Agent URL must be a full URL, e.g. http://192.168.1.50:7420.",
		});
	}

	const rejected = await verifyAgentIfChanged(host, agentUrl, agentToken);
	if (rejected) {
		return rejected;
	}

	await host.update({
		agentUrl,
		isBuildServer: base.isBuildServer,
		name: base.name,
		...(agentToken ? { agentTokenEnc: encryptSecret(agentToken) } : {}),
	});
	logger.info(`Remote host updated: host=${host.id} kind=agent`);
	return { success: true };
}

/** The `kind: "docker"` branch of the update action : a blank TLS field keeps the stored value. */
async function updateDockerHost(
	host: RemoteHostDTO,
	formData: FormData,
	base: UpdateHostBase,
) {
	const dockerHost =
		(formData.get("dockerHost") as string | null)?.trim() ?? "";
	const tlsCa = (formData.get("tlsCa") as string | null)?.trim();
	const tlsCert = (formData.get("tlsCert") as string | null)?.trim();
	const tlsKey = (formData.get("tlsKey") as string | null)?.trim();

	if (!URL.canParse(dockerHost)) {
		return fail(400, {
			error:
				"Docker host must be a URL, e.g. tcp://host:2376 or ssh://user@host.",
		});
	}
	const { protocol } = new URL(dockerHost);
	if (!(protocol === "tcp:" || protocol === "ssh:")) {
		return fail(400, { error: "Only tcp:// and ssh:// hosts are supported." });
	}

	await host.update({
		dockerHost,
		isBuildServer: base.isBuildServer,
		name: base.name,
		...(tlsCa ? { tlsCaEnc: encryptSecret(tlsCa) } : {}),
		...(tlsCert ? { tlsCertEnc: encryptSecret(tlsCert) } : {}),
		...(tlsKey ? { tlsKeyEnc: encryptSecret(tlsKey) } : {}),
	});
	logger.info(`Remote host updated: host=${host.id} kind=docker`);
	return { success: true };
}

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const host = await RemoteHostDTO.get(params.hostId, locals.user.id);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}
		await host.delete();
		logger.info(`Remote host deleted: host=${host.id} user=${locals.user.id}`);
		throw redirect(302, resolve("/remote-hosts"));
	},

	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const host = await RemoteHostDTO.get(params.hostId, locals.user.id);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		if (!name) {
			return fail(400, { error: "Name is required." });
		}

		const base: UpdateHostBase = {
			isBuildServer: formData.get("isBuildServer") === "on",
			name,
		};

		return host.kind === "agent"
			? await updateAgentHost(host, formData, base)
			: await updateDockerHost(host, formData, base);
	},
};
