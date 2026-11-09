import { GitConnectionDTO } from "#lib/dto/git-connection-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { can } from "#lib/permissions.js";

export const load = async ({ parent, locals }) => {
	const { user } = await parent();
	const settings = await InstanceSettingsDTO.get();
	const connections = await GitConnectionDTO.listForUser(user.id);
	const connectedProviderIds = new Set(connections.map((c) => c.providerId));

	return {
		canWrite: can(locals.permissions, "git-providers", "write"),
		connectedProviderIds: [...connectedProviderIds],
		// clientSecretEnc never leaves the server : the form only ever shows
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
