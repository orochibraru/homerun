import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "#lib/config.js";
import { ERROR_PAGE_PATH } from "#lib/error-pages.js";
import { Logger } from "#lib/logger.js";

const logger = new Logger("ErrorPages");

export const ERROR_PAGES_FILE = "homerun-error-pages.yml";

export const ERROR_PAGES_MIDDLEWARE = "homerun-errors@file";

export const ERROR_PAGES_SERVICE = "homerun-error-pages@file";

export const BLOCKED_PAGE_MIDDLEWARE = "homerun-blocked@file";

export const BLOCKED_PROOF_HEADER = "X-Homerun-Blocked";

/**
 * The value Traefik's `homerun-blocked` middleware sets on every request it
 * sends to the blocked page, an HMAC of a fixed label with the auth secret.
 * Only Traefik reads the file it's written to, so a request carrying it
 * provably came through a blocked-paths router, and its last
 * `X-Forwarded-For` hop is Traefik's own view of the client.
 */
export function blockedProofToken(secret: string): string {
	return createHmac("sha256", secret)
		.update("homerun-blocked-proof")
		.digest("hex");
}

/** Whether `value` is the blocked-page proof for `secret`, compared in constant time. */
export function validBlockedProof(
	value: string | null,
	secret: string,
): boolean {
	const expected = Buffer.from(blockedProofToken(secret));
	const actual = Buffer.from(value ?? "");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Where Traefik reaches this app for the error pages: the origin of the login
 * wall's forwardAuth address, which Traefik already has to reach on every
 * gated request, so it needs nothing from this app's own container.
 */
export function errorPagesTarget(authCheckUrl: string): string | null {
	try {
		return new URL(authCheckUrl).origin;
	} catch {
		return null;
	}
}

/**
 * Whether the error pages config file is in Traefik's dynamic config
 * directory, the condition for a service's router to name
 * `ERROR_PAGES_MIDDLEWARE`: a router naming a middleware that doesn't exist
 * is dropped by Traefik, which would take the service offline.
 */
export function errorPagesPublished(): boolean {
	const dir = config.traefik.dynamicConfigDir;
	return Boolean(dir && existsSync(join(dir, ERROR_PAGES_FILE)));
}

/**
 * Renders the Traefik dynamic config for the error pages: a catch-all router
 * at the lowest priority that sends any request no other router claims (a
 * service still deploying, a stopped one, an unknown host) to this app's 404
 * page, the `homerun-errors` middleware every service's router carries,
 * which swaps a 502, 503 or 504 for the matching page, and the
 * `homerun-blocked` middleware a service's blocked-paths router sends its
 * requests through to the blocked page, stamping them with `proof` (see
 * `blockedProofToken`).
 */
export function errorPagesConfig(params: {
	entrypoint: string;
	proof: string;
	target: string;
}): string {
	return `# Written by Homerun for its error pages : do not edit by hand.
http:
  routers:
    homerun-fallback:
      rule: PathPrefix(\`/\`)
      priority: 1
      entryPoints:
        - ${params.entrypoint}
      middlewares:
        - homerun-fallback-page
      service: homerun-error-pages
      tls: {}
  middlewares:
    homerun-fallback-page:
      replacePath:
        path: ${ERROR_PAGE_PATH}/404
    homerun-blocked:
      chain:
        middlewares:
          - homerun-blocked-page
          - homerun-blocked-proof
    homerun-blocked-page:
      replacePath:
        path: ${ERROR_PAGE_PATH}/blocked
    homerun-blocked-proof:
      headers:
        customRequestHeaders:
          ${BLOCKED_PROOF_HEADER}: "${params.proof}"
    homerun-errors:
      errors:
        status:
          - "502-504"
        service: homerun-error-pages
        query: ${ERROR_PAGE_PATH}/{status}
  services:
    homerun-error-pages:
      loadBalancer:
        servers:
          - url: ${params.target}
`;
}

/**
 * Writes the Traefik dynamic-config file behind the branded error pages (see
 * `errorPagesConfig`), pointed at the login wall's forwardAuth origin. Never
 * removes it: every service deployed while it existed names its middleware,
 * and Traefik drops a router whose middleware is missing. Does nothing
 * without a dynamic config directory; failures are logged, not thrown.
 */
export async function syncErrorPages(): Promise<void> {
	const dir = config.traefik.dynamicConfigDir;
	const target = errorPagesTarget(config.authCheckUrl);
	if (!(dir && target)) {
		return;
	}
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, ERROR_PAGES_FILE),
			errorPagesConfig({
				entrypoint: config.traefik.entrypoint,
				proof: blockedProofToken(config.auth.secret),
				target,
			}),
		);
	} catch (err) {
		logger.error("Couldn't publish the error pages config", err);
	}
}
