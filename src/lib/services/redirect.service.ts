import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "#lib/config.js";
import { RedirectDTO } from "#lib/dto/redirect-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { Logger } from "#lib/logger.js";
import {
	REDIRECTS_FILE,
	type RedirectRule,
	redirectsConfig,
	splitSource,
} from "#lib/redirects.js";
import { deleteDns, syncDns } from "./dns.service.ts";
import { certResolverFor } from "./docker/cert-resolver.ts";

/** The host a redirect answers on, or null when its source isn't valid. */
export function redirectHost(source: string): string | null {
	return splitSource(source)?.host ?? null;
}

/** Publishes the enabled redirects to Traefik's file provider and to the DNS/Pangolin automation. */
class RedirectServiceClass {
	private readonly logger = new Logger("Redirects");

	/**
	 * Rewrites the whole redirects file in `config.traefik.dynamicConfigDir`
	 * from the enabled rows (or removes it when there are none), then syncs
	 * every enabled redirect's host through the configured DNS providers and
	 * deletes the ones in `previousHosts` no enabled redirect uses any more.
	 * Hosts a service routes are left to that service. Failures are logged,
	 * not thrown.
	 */
	async sync(previousHosts: string[] = []): Promise<void> {
		const rules = await RedirectDTO.list()
			.then((rows) => rows.map((r) => r.toJSON()))
			.catch((err: unknown) => {
				this.logger.error("Couldn't load the redirects", err);
				return null;
			});
		if (!rules) {
			return;
		}
		await this.#writeTraefikConfig(rules);
		await this.#syncDns(rules, previousHosts);
	}

	/** Syncs the enabled hosts and deletes the dropped ones across every DNS provider, skipping hosts a service routes. */
	async #syncDns(
		rules: RedirectRule[],
		previousHosts: string[],
	): Promise<void> {
		const enabled = [
			...new Set(
				rules
					.filter((rule) => rule.enabled)
					.map((rule) => redirectHost(rule.source))
					.filter((host): host is string => host !== null),
			),
		];
		const removed = [...new Set(previousHosts)].filter(
			(host) => !enabled.includes(host),
		);
		const own = async (hosts: string[]) => {
			const taken = await Promise.all(
				hosts.map((host) => ServiceDTO.domainTaken([host])),
			);
			return hosts.filter((_, i) => taken[i] === null);
		};
		try {
			const results = [
				...(await syncDns(await own(enabled))),
				...(await deleteDns(await own(removed))),
			];
			for (const result of results) {
				if (result.ok) {
					this.logger.info(
						`Redirect DNS (${result.provider}): ${result.detail}`,
					);
				} else {
					this.logger.warn(
						`Redirect DNS sync failed (${result.provider}): ${result.detail}`,
					);
				}
			}
		} catch (err) {
			this.logger.error("Couldn't sync the redirects' DNS", err);
		}
	}

	/** Writes the redirects file Traefik's file provider reads; a no-op when the dynamic config directory isn't set. */
	async #writeTraefikConfig(rules: RedirectRule[]): Promise<void> {
		const dir = config.traefik.dynamicConfigDir;
		if (!dir) {
			this.logger.warn(
				"Traefik's dynamic config directory isn't set, so redirects aren't published",
			);
			return;
		}
		const path = join(dir, REDIRECTS_FILE);
		try {
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
