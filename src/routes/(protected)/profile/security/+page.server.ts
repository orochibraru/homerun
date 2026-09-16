import { config } from "$lib/config";
import { AccountSecurityService } from "$lib/services/account-security.service";

export const load = async ({ parent }) => {
	const { user } = await parent();

	const [rows, passkeys, securityState] = await Promise.all([
		AccountSecurityService.linkedAccounts(user.id),
		AccountSecurityService.listPasskeys(user.id),
		AccountSecurityService.state(user.id),
	]);
	const linked = new Map(rows.map((row) => [row.providerId, row.accountId]));

	return {
		hasPassword: linked.has("credential"),
		passkeys,
		providers: config.auth.oauthProviders
			.filter((provider) => provider.enabled)
			.map((provider) => ({
				accountId: linked.get(provider.name) ?? null,
				linked: linked.has(provider.name),
				name: provider.name,
			})),
		twoFactorEnabled: securityState.twoFactorEnabled,
	};
};
