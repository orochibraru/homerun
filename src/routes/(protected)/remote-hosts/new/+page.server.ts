import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { AgentClientService } from "$lib/services/agent-client.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("RemoteHosts");

interface NewHostBase {
	isBuildServer: boolean;
	name: string;
	userId: string;
}

/** The `kind: "agent"` branch : validate the URL, verify the token against the live agent, then persist. */
async function createAgentHost(formData: FormData, base: NewHostBase) {
	const agentUrl = (formData.get("agentUrl") as string | null)?.trim() ?? "";
	const agentToken =
		(formData.get("agentToken") as string | null)?.trim() ?? "";

	if (!(agentUrl && agentToken)) {
		return fail(400, { error: "Agent URL and token are required." });
	}
	if (!URL.canParse(agentUrl)) {
		return fail(400, {
			error: "Agent URL must be a full URL, e.g. http://192.168.1.50:7420.",
		});
	}

	try {
		await AgentClientService.verifyToken(agentUrl, agentToken);
	} catch (error) {
		return fail(400, {
			error:
				error instanceof Error ? error.message : "Couldn't verify the agent.",
		});
	}

	const host = await RemoteHostDTO.create({
		agentTokenEnc: encryptSecret(agentToken),
		agentUrl,
		isBuildServer: base.isBuildServer,
		kind: "agent",
		name: base.name,
		userId: base.userId,
	});

	logger.info(
		`Remote host added: host=${host.id} kind=agent agentUrl=${agentUrl} user=${base.userId}`,
	);

	return { hostId: host.id, success: true };
}

/** The `kind: "docker"` branch : a raw tcp:// or ssh:// daemon URL plus optional TLS material. */
async function createDockerHost(formData: FormData, base: NewHostBase) {
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

	const host = await RemoteHostDTO.create({
		dockerHost,
		isBuildServer: base.isBuildServer,
		kind: "docker",
		name: base.name,
		tlsCaEnc: tlsCa ? encryptSecret(tlsCa) : null,
		tlsCertEnc: tlsCert ? encryptSecret(tlsCert) : null,
		tlsKeyEnc: tlsKey ? encryptSecret(tlsKey) : null,
		userId: base.userId,
	});

	logger.info(
		`Remote host added: host=${host.id} kind=docker dockerHost=${dockerHost} user=${base.userId}`,
	);

	return { hostId: host.id, success: true };
}

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		if (!name) {
			return fail(400, { error: "Name is required." });
		}

		const base: NewHostBase = {
			isBuildServer: formData.get("isBuildServer") === "on",
			name,
			userId: locals.user.id,
		};

		return formData.get("kind") === "agent"
			? await createAgentHost(formData, base)
			: await createDockerHost(formData, base);
	},
};
