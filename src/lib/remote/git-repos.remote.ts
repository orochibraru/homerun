import { error } from "@sveltejs/kit";
import { z } from "zod";
import { query } from "$app/server";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { requireUser } from "$lib/server/remote-auth";
import {
	GitProviderService,
	type GitRepo,
} from "$lib/services/git-provider.service";

const logger = new Logger("GitProviders");

async function resolveConnection(providerId: string, userId: string) {
	const settings = await InstanceSettingsDTO.get();
	const provider = settings.gitProviders.find((p) => p.id === providerId);
	if (!provider) {
		error(404, "Git provider not found.");
	}

	const connection = await GitConnectionDTO.getForUserAndProvider(
		userId,
		provider.id,
	);
	if (!connection) {
		error(400, "Not connected to this provider.");
	}

	return { connection, provider };
}

export const listProviderRepos = query(
	z.string(),
	async (providerId): Promise<GitRepo[]> => {
		const user = requireUser();
		const { connection, provider } = await resolveConnection(
			providerId,
			user.id,
		);

		try {
			return await GitProviderService.listRepos(provider, connection);
		} catch (err) {
			logger.warn(`Repo listing failed: provider=${provider.id}`, err);
			error(502, "Couldn't list repos.");
		}
	},
);

export const hasDockerfile = query(
	z.object({ providerId: z.string(), ref: z.string(), repo: z.string() }),
	async ({ providerId, ref, repo }): Promise<boolean> => {
		const user = requireUser();
		const { connection, provider } = await resolveConnection(
			providerId,
			user.id,
		);
		return await GitProviderService.hasDockerfile(
			provider,
			connection,
			repo,
			ref,
		);
	},
);
