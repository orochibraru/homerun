import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "#lib/config.js";
import { StatusPageDTO } from "#lib/dto/status-page-dto.js";
import { Logger } from "#lib/logger.js";
import {
	normalizeStatusDomains,
	STATUS_PAGES_FILE,
	statusPagesConfig,
} from "#lib/status-page-domains.js";
import type { StatusPagePick } from "#lib/status-page-members.js";
import type { StatusPageScope } from "#lib/types.js";
import { deleteDns, syncDns } from "./dns.service.ts";
import { certResolverFor } from "./docker/cert-resolver.ts";
import { errorPagesTarget } from "./docker/error-pages.ts";

const logger = new Logger("StatusPages");

/** A status page change refused for one field; nothing was saved. */
export class StatusPageSettingsError extends Error {
	constructor(
		readonly field: "domains" | "slug" | "stackId",
		message: string,
	) {
		super(message);
	}
}

export interface StatusPageSettings {
	description: string | null;
	domains: string[];
	isPublic: boolean;
	name: string;
	picks: StatusPagePick[];
	scope: StatusPageScope;
	slug: string;
	stackId: string | null;
}

/**
 * Creating and editing status pages, shared by the dashboard's forms and the
 * REST API: a unique slug, a stack for a stack page, the hand-picked
 * services of a custom one, and the domains a public page also answers on.
 */
class StatusPageSettingsServiceClass {
	/**
	 * Creates a status page.
	 *
	 * @throws {StatusPageSettingsError} When the slug is taken or a stack
	 *   page has no stack.
	 */
	async create(
		input: StatusPageSettings,
		userId: string,
	): Promise<StatusPageDTO> {
		const domains = await this.#check(input, null);
		const page = await StatusPageDTO.create({
			...this.#columns(input),
			domains,
			userId,
		});
		if (input.scope === "custom") {
			await page.setPicks(input.picks);
		}
		await this.syncRoutes();
		return page;
	}

	/**
	 * Replaces a status page's settings with `input`.
	 *
	 * @throws {StatusPageSettingsError} When the slug is taken or a stack
	 *   page has no stack.
	 */
	async update(page: StatusPageDTO, input: StatusPageSettings): Promise<void> {
		const previous = page.domains;
		const domains = await this.#check(input, page.id);
		await page.update({ ...this.#columns(input), domains });
		if (input.scope === "custom") {
			await page.setPicks(input.picks);
		}
		await this.syncRoutes(previous);
	}

	/** The row columns of `input`: a stack only for a stack page. */
	#columns(input: StatusPageSettings) {
		return {
			description: input.description || null,
			isPublic: input.isPublic,
			name: input.name,
			scope: input.scope,
			slug: input.slug,
			stackId: input.scope === "stack" ? input.stackId : null,
		};
	}

	/** Deletes a status page and takes its domains off Traefik and DNS. */
	async delete(page: StatusPageDTO): Promise<void> {
		const previous = page.domains;
		await page.delete();
		await this.syncRoutes(previous);
	}

	/**
	 * Rewrites the status pages' Traefik routes from every public page's
	 * domains (or removes the file when none has one), syncs those domains'
	 * DNS without Pangolin SSO (a status page is for people who aren't
	 * signed in), and deletes the DNS of `previousDomains` no page uses any
	 * more. Failures are logged, never thrown.
	 */
	async syncRoutes(previousDomains: string[] = []): Promise<void> {
		const pages = await StatusPageDTO.list();
		const live = pages
			.filter((page) => page.isPublic)
			.flatMap((page) => page.domains);
		const dir = config.traefik.dynamicConfigDir;
		const target = errorPagesTarget(config.authCheckUrl);
		if (dir && target) {
			const content = statusPagesConfig(
				pages.map((page) => ({
					domains: page.domains,
					isPublic: page.isPublic,
					slug: page.slug,
				})),
				{
					certResolverFor: (host) =>
						certResolverFor(
							host,
							config.traefik.certResolver,
							config.pangolinEnabled,
							config.traefik.instanceCertNames,
						),
					entrypoint: config.traefik.entrypoint,
					target,
				},
			);
			const path = join(dir, STATUS_PAGES_FILE);
			try {
				if (content === null) {
					await rm(path, { force: true });
				} else {
					await mkdir(dir, { recursive: true });
					await writeFile(path, content);
				}
			} catch (err) {
				logger.error("Couldn't publish the status pages' domains", err);
			}
		}
		const dropped = previousDomains.filter((domain) => !live.includes(domain));
		const results = [
			...(live.length > 0 ? await syncDns(live, { sso: false }) : []),
			...(dropped.length > 0 ? await deleteDns(dropped) : []),
		];
		for (const result of results) {
			if (!result.ok) {
				logger.warn(`DNS sync failed (${result.provider}): ${result.detail}`);
			}
		}
	}

	/** A free slug, a stack for a stack page, and valid domains no other page answers on. */
	async #check(
		input: StatusPageSettings,
		exceptId: string | null,
	): Promise<string[]> {
		if (await StatusPageDTO.slugTaken(input.slug, exceptId ?? undefined)) {
			throw new StatusPageSettingsError("slug", "That slug is already taken.");
		}
		if (input.scope === "stack" && !input.stackId) {
			throw new StatusPageSettingsError(
				"stackId",
				"Pick the stack this page covers.",
			);
		}
		const normalized = normalizeStatusDomains(input.domains);
		if ("error" in normalized) {
			throw new StatusPageSettingsError("domains", normalized.error);
		}
		const owner = await StatusPageDTO.domainOwner(
			normalized.domains,
			exceptId ?? undefined,
		);
		if (owner) {
			throw new StatusPageSettingsError(
				"domains",
				`${owner.domain} already serves the ${owner.name} status page.`,
			);
		}
		return normalized.domains;
	}
}

export const StatusPageSettingsService = new StatusPageSettingsServiceClass();
