import { verifyGateToken } from "$lib/server/app-gate";
import { gatedService } from "$lib/server/gated-service-cache";

export const APP_AUTH_PATH = "/app-auth";

/**
 * The gated app's name and allowed sign-in methods when `target` is a
 * login-wall return path (`/app-auth?rd=<signed token>`) for a service that's
 * still gated, so the sign-in page can say which app the visitor is signing in
 * to and offer only the methods its wall accepts. Null for any other target,
 * or an invalid or expired token.
 */
export async function gatedAppFor(
	target: string | null,
): Promise<{ methods: string[]; name: string } | null> {
	if (!target) {
		return null;
	}
	const parsed = new URL(target, "http://homerun.invalid");
	if (parsed.pathname !== APP_AUTH_PATH) {
		return null;
	}
	const rd = parsed.searchParams.get("rd");
	const request = rd ? verifyGateToken(rd) : null;
	if (!request) {
		return null;
	}
	const svc = await gatedService(request.serviceId);
	return svc?.authRequired
		? { methods: svc.authProviders, name: svc.name }
		: null;
}
