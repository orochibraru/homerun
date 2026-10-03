import { config } from "#lib/config.js";
import { rebaseOnOrigin } from "#lib/oidc-provider.js";
import { auth } from "#lib/services/auth.js";

export const GET = async ({ request }) =>
	await auth.handler(
		config.auth.origin ? rebaseOnOrigin(request, config.auth.origin) : request,
	);
