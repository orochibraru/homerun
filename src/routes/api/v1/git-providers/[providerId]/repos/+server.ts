import { json } from "@sveltejs/kit";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { GitProviderService } from "$lib/services/git-provider.service";

const logger = new Logger("GitProviders");

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const settings = await InstanceSettingsDTO.get();
	const provider = settings.gitProviders.find(
		(p) => p.id === params.providerId,
	);
	if (!provider) {
		return json({ error: "Git provider not found." }, { status: 404 });
	}

	const connection = await GitConnectionDTO.getForUserAndProvider(
		locals.user.id,
		provider.id,
	);
	if (!connection) {
		return json({ error: "Not connected to this provider." }, { status: 400 });
	}

	try {
		const repos = await GitProviderService.listRepos(provider, connection);
		return json({ repos });
	} catch (err) {
		logger.warn(`Repo listing failed: provider=${provider.id}`, err);
		return json({ error: "Couldn't list repos." }, { status: 502 });
	}
};
