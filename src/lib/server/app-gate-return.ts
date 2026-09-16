import { verifyGateToken } from "$lib/server/app-gate";
import { gatedService } from "$lib/server/gated-service-cache";

export const APP_AUTH_PATH = "/app-auth";

/**
 * The gated app's name when `target` is a login-wall return path
 * (`/app-auth?rd=<signed token>`) for a service that's still gated, so the
 * sign-in page can say which app the visitor is signing in to. Null for any
 * other target, or an invalid or expired token.
 */
export async function gatedAppNameFor(
	target: string | null,
): Promise<string | null> {
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
	return svc?.authRequired ? svc.name : null;
}
