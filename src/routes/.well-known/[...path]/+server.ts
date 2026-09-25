import { config } from "$lib/config";
import { rebaseOnOrigin } from "$lib/oidc-provider";
import { auth } from "$lib/services/auth";

export const GET = async ({ request }) =>
	await auth.handler(
		config.auth.origin ? rebaseOnOrigin(request, config.auth.origin) : request,
	);
