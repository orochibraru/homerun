import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "#lib/config.js";
import { ERROR_PAGE_PATH } from "#lib/error-pages.js";
import { Logger } from "#lib/logger.js";

const logger = new Logger("ErrorPages");

export const ERROR_PAGES_FILE = "homerun-error-pages.yml";

export const ERROR_PAGES_MIDDLEWARE = "homerun-errors@file";

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
 * page, and the `homerun-errors` middleware every service's router carries,
 * which swaps a 502, 503 or 504 for the matching page.
 */
export function errorPagesConfig(params: {
	entrypoint: string;
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
			errorPagesConfig({ entrypoint: config.traefik.entrypoint, target }),
		);
	} catch (err) {
		logger.error("Couldn't publish the error pages config", err);
	}
}
