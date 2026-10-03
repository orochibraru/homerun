import { config, isSmtpEnabled } from "#lib/config.js";
import { setPasswordActions } from "#lib/server/set-password-actions.js";
import { AccountSecurityService } from "#lib/services/account-security.service.js";

export const load = async ({ parent }) => {
	const { user } = await parent();

	const [rows, passkeys, securityState] = await Promise.all([
		AccountSecurityService.linkedAccounts(user.id),
		AccountSecurityService.listPasskeys(user.id),
		AccountSecurityService.state(user.id),
	]);
	const linked = new Map(rows.map((row) => [row.providerId, row.accountId]));

	return {
		email: user.email,
		hasPassword: linked.has("credential"),
		passkeys,
		providers: config.auth.oauthProviders
			.filter((provider) => provider.enabled)
			.map((provider) => ({
				accountId: linked.get(provider.name) ?? null,
				linked: linked.has(provider.name),
				name: provider.name,
			})),
		smtpEnabled: isSmtpEnabled(),
		twoFactorEnabled: securityState.twoFactorEnabled,
	};
};

export const actions = setPasswordActions;
