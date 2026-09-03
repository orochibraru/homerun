import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { AgentClientService } from "$lib/services/agent-client.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("RemoteHosts");

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const kind = formData.get("kind") === "agent" ? "agent" : "docker";
		const isBuildServer = formData.get("isBuildServer") === "on";

		if (!name) {
			return fail(400, { error: "Name is required." });
		}

		if (kind === "agent") {
			const agentUrl =
				(formData.get("agentUrl") as string | null)?.trim() ?? "";
			const agentToken =
				(formData.get("agentToken") as string | null)?.trim() ?? "";

			if (!(agentUrl && agentToken)) {
				return fail(400, {
					error: "Agent URL and token are required.",
				});
			}
			try {
				new URL(agentUrl);
			} catch {
				return fail(400, {
					error: "Agent URL must be a full URL, e.g. http://192.168.1.50:7420.",
				});
			}

			try {
				await AgentClientService.verifyToken(agentUrl, agentToken);
			} catch (error) {
				return fail(400, {
					error:
						error instanceof Error
							? error.message
							: "Couldn't verify the agent.",
				});
			}

			const host = await RemoteHostDTO.create({
				agentTokenEnc: encryptSecret(agentToken),
				agentUrl,
				isBuildServer,
				kind: "agent",
				name,
				userId: locals.user.id,
			});

			logger.info(
				`Remote host added: host=${host.id} kind=agent agentUrl=${agentUrl} user=${locals.user.id}`,
			);

			return { hostId: host.id, success: true };
		}

		const dockerHost =
			(formData.get("dockerHost") as string | null)?.trim() ?? "";
		const tlsCa = (formData.get("tlsCa") as string | null)?.trim();
		const tlsCert = (formData.get("tlsCert") as string | null)?.trim();
		const tlsKey = (formData.get("tlsKey") as string | null)?.trim();

		let url: URL;
		try {
			url = new URL(dockerHost);
		} catch {
			return fail(400, {
				error:
					"Docker host must be a URL, e.g. tcp://host:2376 or ssh://user@host.",
			});
		}
		if (!(url.protocol === "tcp:" || url.protocol === "ssh:")) {
			return fail(400, {
				error: "Only tcp:// and ssh:// hosts are supported.",
			});
		}

		const host = await RemoteHostDTO.create({
			dockerHost,
			isBuildServer,
			kind: "docker",
			name,
			tlsCaEnc: tlsCa ? encryptSecret(tlsCa) : null,
			tlsCertEnc: tlsCert ? encryptSecret(tlsCert) : null,
			tlsKeyEnc: tlsKey ? encryptSecret(tlsKey) : null,
			userId: locals.user.id,
		});

		logger.info(
			`Remote host added: host=${host.id} kind=docker dockerHost=${dockerHost} user=${locals.user.id}`,
		);

		return { hostId: host.id, success: true };
	},
};
