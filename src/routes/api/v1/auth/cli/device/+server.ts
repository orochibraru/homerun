import { json } from "@sveltejs/kit";
import { browserOrigin } from "$lib/server/canonical-origin";
import { CliAuthService } from "$lib/services/cli-auth.service";

/**
 * Deliberately unauthenticated, this is the start of the CLI's login flow,
 * the caller has no credentials yet (that's the whole point). Nothing
 * sensitive is handed back, just a pair of random codes.
 */
export const POST = ({ request, url }) => {
	const origin = browserOrigin(request, url);
	const { deviceCode, userCode, expiresIn, interval } =
		CliAuthService.startDeviceAuth();

	return json({
		deviceCode,
		expiresIn,
		interval,
		userCode,
		verificationUri: `${origin}/cli-auth`,
		verificationUriComplete: `${origin}/cli-auth?code=${encodeURIComponent(userCode)}`,
	});
};
