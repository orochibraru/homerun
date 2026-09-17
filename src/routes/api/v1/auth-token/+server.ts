import { json } from "@sveltejs/kit";
import { CliAuthService } from "$lib/services/cli-auth.service";

/**
 * Revokes the API key that authenticated this very request, `homerun
 * logout`'s server-side counterpart to clearing the local config
 * (`packages/cli/login.ts`). Not under `/api/v1/auth/`: every path there is
 * routed to better-auth's own catch-all handler first
 * (`hooks.server.ts`'s `customAuthPaths`), which would 404 an
 * undeclared one, same real bug the CLI's device-code endpoints hit.
 */
export const DELETE = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const authHeader = request.headers.get("authorization");
	const rawKey =
		request.headers.get("x-api-key") ??
		(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
	if (!rawKey) {
		return json(
			{
				error:
					"Nothing to revoke: this request wasn't authenticated with an API key (x-api-key or Authorization: Bearer).",
			},
			{ status: 400 },
		);
	}

	const revoked = await CliAuthService.revokeApiKey(rawKey, locals.user.id);
	return json({ success: revoked });
};
