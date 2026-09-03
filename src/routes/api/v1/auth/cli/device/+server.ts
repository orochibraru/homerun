import { json } from "@sveltejs/kit";
import { CliAuthService } from "$lib/services/cli-auth.service";

/**
 * Deliberately unauthenticated, this is the start of the CLI's login flow,
 * the caller has no credentials yet (that's the whole point). Nothing
 * sensitive is handed back, just a pair of random codes.
 */
export const POST = ({ url }) => {
	const { deviceCode, userCode, expiresIn, interval } =
		CliAuthService.startDeviceAuth();

	return json({
		deviceCode,
		expiresIn,
		interval,
		userCode,
		verificationUri: `${url.origin}/cli-auth`,
		verificationUriComplete: `${url.origin}/cli-auth?code=${encodeURIComponent(userCode)}`,
	});
};
