import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "$lib/config";
import { RedirectDTO } from "$lib/dto/redirect-dto";
import { Logger } from "$lib/logger";
import { REDIRECTS_FILE, redirectsConfig } from "$lib/redirects";
import { certResolverFor } from "./docker/cert-resolver.ts";

/** Publishes the enabled redirects to Traefik's file provider. */
class RedirectServiceClass {
	private readonly logger = new Logger("Redirects");

	/**
	 * Rewrites the whole redirects file in `config.traefik.dynamicConfigDir`
	 * from the enabled rows (or removes it when there are none). A no-op when
	 * the directory isn't set; failures are logged, not thrown.
	 */
	async sync(): Promise<void> {
		const dir = config.traefik.dynamicConfigDir;
		if (!dir) {
			return;
		}
		const path = join(dir, REDIRECTS_FILE);
		try {
			const rules = (await RedirectDTO.list()).map((r) => r.toJSON());
			const content = redirectsConfig(rules, {
				certResolver: (host) =>
					certResolverFor(
						host,
						config.traefik.certResolver,
						config.pangolinEnabled,
						config.traefik.instanceCertNames,
					),
				entrypoint: config.traefik.entrypoint,
			});
			if (content === null) {
				await rm(path, { force: true });
				return;
			}
			await mkdir(dir, { recursive: true });
			await writeFile(path, content);
			this.logger.info("Redirects published to Traefik");
		} catch (err) {
			this.logger.error("Couldn't publish the redirects", err);
		}
	}
}

export const RedirectService = new RedirectServiceClass();
