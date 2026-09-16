import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "$lib/config";

export const GATE_COOKIE_NAME = "homerun_app_session";
export const GATE_CALLBACK_PATH = "/__homerun_auth/callback";
export const GATE_LOGOUT_PATH = "/__homerun_auth/logout";

export const GATE_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const GATE_GRANT_TTL_MS = 60 * 1000;
export const GATE_REDIRECT_TTL_MS = 10 * 60 * 1000;

export interface GateTokenPayload {
	email?: string;
	host: string;
	name?: string;
	policyVersion?: string;
	serviceId: string;
	target?: string;
	userId?: string;
}

export interface GatePolicy {
	authAllowedEmails: string[];
	authAllowedGroups: string[];
	authAllowedUserIds: string[];
	authProviders: string[];
	authRequired: boolean;
}

/**
 * A short fingerprint of a service's login-wall policy, embedded in gate tokens
 * so that changing who may access the service invalidates sessions issued under
 * the old policy.
 */
export function policyVersion(policy: GatePolicy): string {
	const canonical = JSON.stringify([
		policy.authRequired,
		[...policy.authProviders].sort(),
		[...policy.authAllowedUserIds].sort(),
		[...policy.authAllowedEmails].sort(),
		[...policy.authAllowedGroups].sort(),
	]);
	return sign(canonical).slice(0, 16);
}

interface SignedEnvelope extends GateTokenPayload {
	exp: number;
}

function sign(data: string): string {
	return createHmac("sha256", config.auth.secret)
		.update(data)
		.digest("base64url");
}

/**
 * Signs a login-wall payload into a `<base64url body>.<HMAC>` token that
 * expires after `ttlMs`, using the auth secret.
 */
export function signGateToken(
	payload: GateTokenPayload,
	ttlMs: number,
): string {
	const envelope: SignedEnvelope = { ...payload, exp: Date.now() + ttlMs };
	const body = Buffer.from(JSON.stringify(envelope)).toString("base64url");
	return `${body}.${sign(body)}`;
}

/**
 * Checks a gate token's signature in constant time and its expiry and required
 * fields.
 *
 * @returns The payload, or null for anything tampered with, expired or
 * malformed.
 */
export function verifyGateToken(token: string): GateTokenPayload | null {
	const dot = token.lastIndexOf(".");
	if (dot <= 0) {
		return null;
	}
	const body = token.slice(0, dot);
	const provided = Buffer.from(token.slice(dot + 1));
	const expected = Buffer.from(sign(body));
	if (
		provided.length !== expected.length ||
		!timingSafeEqual(provided, expected)
	) {
		return null;
	}
	try {
		const envelope = JSON.parse(
			Buffer.from(body, "base64url").toString("utf8"),
		) as SignedEnvelope;
		if (
			typeof envelope.exp !== "number" ||
			envelope.exp < Date.now() ||
			typeof envelope.host !== "string" ||
			typeof envelope.serviceId !== "string"
		) {
			return null;
		}
		return envelope;
	} catch {
		return null;
	}
}

/**
 * Pulls the login-wall session cookie out of a raw `Cookie` header, as
 * forwarded from the gated app's own host.
 *
 * @returns The decoded cookie value, or undefined when it isn't present.
 */
export function readGateCookie(
	cookieHeader: string | null,
): string | undefined {
	if (!cookieHeader) {
		return undefined;
	}
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) {
			continue;
		}
		if (part.slice(0, eq).trim() === GATE_COOKIE_NAME) {
			return decodeURIComponent(part.slice(eq + 1).trim());
		}
	}
	return undefined;
}

/**
 * Builds the `Set-Cookie` value for the login-wall session cookie : HttpOnly,
 * SameSite=Lax, path `/`, Secure when requested. A max age of 0 clears it.
 */
export function gateCookie(
	value: string,
	secure: boolean,
	maxAgeSeconds: number,
) {
	const attrs = [
		`${GATE_COOKIE_NAME}=${encodeURIComponent(value)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
	];
	if (secure) {
		attrs.push("Secure");
	}
	return attrs.join("; ");
}
