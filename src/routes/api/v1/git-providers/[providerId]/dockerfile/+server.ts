import { json } from "@sveltejs/kit";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { GitProviderService } from "$lib/services/git-provider.service";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const repo = url.searchParams.get("repo");
	const ref = url.searchParams.get("ref") || "main";
	if (!repo) {
		return json({ error: "Missing repo." }, { status: 400 });
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

	const exists = await GitProviderService.hasDockerfile(
		provider,
		connection,
		repo,
		ref,
	);
	return json({ exists });
};
