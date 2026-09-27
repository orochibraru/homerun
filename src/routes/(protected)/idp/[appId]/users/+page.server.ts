import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { OauthClientDTO } from "$lib/dto/oauth-client-dto";
import { OauthGrantDTO } from "$lib/dto/oauth-grant-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("OidcProvider");

export const load = async ({ parent }) => {
	const { app } = await parent();
	return { grantees: await OauthGrantDTO.listForClient(app.clientId) };
};

export const actions = {
	revoke: async ({ locals, params, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const app = await OauthClientDTO.get(params.appId);
		if (!app) {
			return fail(404, { error: "That app isn't registered." });
		}
		const userId = String((await request.formData()).get("userId") ?? "");
		const targets = userId
			? [userId]
			: (await OauthGrantDTO.listForClient(app.clientId)).map(
					(grantee) => grantee.userId,
				);
		await Promise.all(
			targets.map((target) =>
				OauthGrantDTO.revokeForUser(target, app.clientId),
			),
		);
		logger.info(
			`OAuth app access revoked: client=${app.clientId} users=${targets.length} user=${locals.user.id}`,
		);
		return { revoked: targets.length };
	},
};
