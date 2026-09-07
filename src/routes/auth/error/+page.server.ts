import { config } from "$lib/config";

export const load = async ({ locals }) => ({
	providers: config.auth.oauthProviders
		.filter((provider) => provider.enabled)
		.map((provider) => ({
			label: provider.label || provider.name,
			name: provider.name,
		})),
	signedInAs: locals.user?.email ?? null,
});
