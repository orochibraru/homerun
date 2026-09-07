import { config } from "$lib/config";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import {
	GATE_CALLBACK_PATH,
	GATE_LOGOUT_PATH,
	GATE_REDIRECT_TTL_MS,
	GATE_SESSION_TTL_MS,
	gateCookie,
	policyVersion,
	readGateCookie,
	signGateToken,
	verifyGateToken,
} from "$lib/server/app-gate";
import { gatedService } from "$lib/server/gated-service-cache";
import { AppAccessService } from "$lib/services/app-access.service";

const logger = new Logger("AppGate");

interface ForwardedRequest {
	host: string;
	origin: string;
	path: string;
	search: string;
	secure: boolean;
	url: string;
}

function readForwarded(request: Request, fallback: URL): ForwardedRequest {
	const host = request.headers.get("x-forwarded-host") ?? fallback.host;
	const proto = request.headers.get("x-forwarded-proto") ?? "https";
	const uri = request.headers.get("x-forwarded-uri") ?? "/";
	const queryAt = uri.indexOf("?");
	const path = queryAt === -1 ? uri : uri.slice(0, queryAt);
	const search = queryAt === -1 ? "" : uri.slice(queryAt);
	const origin = `${proto}://${host}`;
	return {
		host,
		origin,
		path,
		search,
		secure: proto === "https",
		url: `${origin}${uri}`,
	};
}

function deny(message: string, status: number): Response {
	return new Response(message, {
		headers: { "content-type": "text/plain; charset=utf-8" },
		status,
	});
}

function redirect(to: string, cookie?: string): Response {
	const headers = new Headers({ location: to });
	if (cookie) {
		headers.append("set-cookie", cookie);
	}
	return new Response(null, { headers, status: 302 });
}

function challenge(svc: ServiceDTO, forwarded: ForwardedRequest): Response {
	const dashboard = config.auth.origin;
	if (!dashboard) {
		return deny(
			"This app is gated behind Homerun's login, but Homerun doesn't know its own public URL yet, so it can't send you to a sign-in page. Set Origin under Settings → General.",
			500,
		);
	}
	const token = signGateToken(
		{ host: forwarded.host, serviceId: svc.id, target: forwarded.url },
		GATE_REDIRECT_TTL_MS,
	);
	const to = new URL("/app-auth", dashboard);
	to.searchParams.set("rd", token);
	return redirect(to.toString());
}

async function handleCallback(
	svc: ServiceDTO,
	forwarded: ForwardedRequest,
): Promise<Response> {
	const token = new URLSearchParams(forwarded.search).get("token");
	const payload = token ? verifyGateToken(token) : null;
	if (
		!payload?.userId ||
		payload.serviceId !== svc.id ||
		payload.host !== forwarded.host
	) {
		return challenge(svc, forwarded);
	}

	const decision = await AppAccessService.evaluate(svc, payload.userId);
	if (!decision.allowed) {
		return challenge(svc, forwarded);
	}

	const session = signGateToken(
		{
			email: payload.email,
			host: forwarded.host,
			name: payload.name,
			policyVersion: policyVersion(svc),
			serviceId: svc.id,
			userId: payload.userId,
		},
		GATE_SESSION_TTL_MS,
	);
	logger.info(
		`App gate granted: service=${svc.id} user=${payload.userId} host=${forwarded.host}`,
	);
	return redirect(
		payload.target ?? forwarded.origin,
		gateCookie(session, forwarded.secure, GATE_SESSION_TTL_MS / 1000),
	);
}

export const GET = async ({ request, url }) => {
	const serviceId = url.searchParams.get("service");
	if (!serviceId) {
		return deny("Unauthorized", 401);
	}

	const svc = await gatedService(serviceId);
	if (!svc) {
		return deny("Unauthorized", 401);
	}
	if (!svc.authRequired) {
		return new Response("OK", { status: 200 });
	}

	const forwarded = readForwarded(request, url);

	if (forwarded.path === GATE_LOGOUT_PATH) {
		return redirect(forwarded.origin, gateCookie("", forwarded.secure, 0));
	}
	if (forwarded.path === GATE_CALLBACK_PATH) {
		return await handleCallback(svc, forwarded);
	}

	const cookie = readGateCookie(request.headers.get("cookie"));
	const payload = cookie ? verifyGateToken(cookie) : null;
	if (
		payload?.userId &&
		payload.serviceId === svc.id &&
		payload.host === forwarded.host &&
		payload.policyVersion === policyVersion(svc)
	) {
		return new Response("OK", {
			headers: {
				"x-homerun-email": payload.email ?? "",
				"x-homerun-name": payload.name ?? "",
				"x-homerun-user": payload.userId,
			},
			status: 200,
		});
	}

	return challenge(svc, forwarded);
};
