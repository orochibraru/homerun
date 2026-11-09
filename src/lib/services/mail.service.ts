import { generateKeyPairSync } from "node:crypto";
import { Resolver } from "node:dns/promises";

import { config } from "#lib/config.js";
import { DomainDTO } from "#lib/dto/domain-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { MailAliasDTO } from "#lib/dto/mail-alias-dto.js";
import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { Logger } from "#lib/logger.js";
import {
	type AliasEntry,
	DKIM_SELECTOR,
	dkimKeyPath,
	dkimSigningConf,
	dovecotQuotas,
	isMailAddress,
	isPurgeablePath,
	joinTxtStrings,
	localPartProblem,
	mailAddress,
	type MailboxEntry,
	type MailDnsRecord,
	mailPasswordProblem,
	type MailRecordState,
	mailRecordState,
	postfixAccounts,
	postfixVirtual,
	requiredMailRecords,
} from "#lib/mail.js";
import { DOMAIN_RE } from "#lib/service-domains.js";

import { normalizeName } from "./dns-providers/http.ts";
import type { DnsRecordInput } from "./dns-providers/types.ts";
import { syncCoreHostDns } from "./dns.service.ts";
import {
	DockerService,
	type MailConfigFile,
	type MailHealth,
} from "./docker.service.ts";
import {
	MAIL_CONFIG_DIR,
	MAIL_CONTAINER_NAME,
	mailCertResolver,
} from "./docker/mail-container.ts";
import { DomainDnsService } from "./domain-dns.service.ts";
import { PangolinMailPorts } from "./pangolin/mail-ports.ts";

const logger = new Logger("Mail");

const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const BCRYPT_COST = 10;
const KB_PER_MB = 1024;
const TAB_RE = /\t/;
const BCRYPT_PREFIX_RE = /^\$2[ab]\$/;

export interface MailStatus {
	certificate: boolean;
	containerName: string;
	domainCount: number;
	enabled: boolean;
	hostname: string | null;
	health: MailHealth | null;
	mailboxCount: number;
	running: boolean;
	stoppedReason: string | null;
	suggestedHostname: string;
}

export interface MailRecordCheck {
	found: string[];
	record: MailDnsRecord;
	state: MailRecordState;
}

export interface MailboxInput {
	displayName: string | null;
	enabled: boolean;
	quotaMb: number | null;
}

export interface MailboxUsage {
	limitMb: number | null;
	usedMb: number;
}

/** The values a name resolves to for `type`, empty when it has none or doesn't exist. */
async function resolveValues(
	resolver: Resolver,
	name: string,
	type: MailDnsRecord["type"],
): Promise<string[]> {
	try {
		if (type === "MX") {
			return (await resolver.resolveMx(name)).map((mx) =>
				mx.exchange.toLowerCase(),
			);
		}
		if (type === "A") {
			return await resolver.resolve4(name);
		}
		return joinTxtStrings(await resolver.resolveTxt(name));
	} catch {
		return [];
	}
}

/** The postmaster address for a mail hostname: `postmaster@` its parent domain. */
function postmasterFor(hostname: string): string {
	const parent = hostname.split(".").slice(1).join(".");
	return `postmaster@${parent.includes(".") ? parent : hostname}`;
}

/**
 * The mail server: domains, mailboxes and aliases kept in Homerun's database
 * and written into a docker-mailserver container's config files, which it
 * reloads on its own. Every change to them goes through `sync`, queued as a
 * core service job.
 */
class MailServiceClass {
	/** The hostname the mail server answers as: the saved one, else `mail.` the base domain. */
	async hostname(): Promise<string | null> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		return this.hostnameFor(row.mailHostname ?? "");
	}

	/** The hostname the server answers to once `host` is saved: `host` normalized, or `mail.<base domain>` when it's blank. */
	hostnameFor(host: string): string | null {
		const normalized = host.trim().toLowerCase();
		if (normalized) {
			return normalized;
		}
		return config.baseDomain ? `mail.${config.baseDomain}` : null;
	}

	/** The toggle, hostname, counts and whether the container runs, with why it doesn't when it should. */
	async status(): Promise<MailStatus> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		const [domains, mailboxes, health, certSource, hostname] =
			await Promise.all([
				MailDomainDTO.list(),
				MailMailboxDTO.list(),
				DockerService.mailHealth().catch(() => null),
				DockerService.mailCertSource().catch(() => null),
				this.hostname(),
			]);
		const enabled = row.mailEnabled === true;
		return {
			certificate: certSource !== null,
			containerName: MAIL_CONTAINER_NAME,
			domainCount: domains.length,
			enabled,
			hostname,
			health,
			mailboxCount: mailboxes.length,
			running: health?.running === true,
			stoppedReason: enabled
				? this.#stoppedReason(
						hostname,
						mailboxes.filter((box) => box.toJSON().enabled).length,
					)
				: null,
			suggestedHostname: config.baseDomain ? `mail.${config.baseDomain}` : "",
		};
	}

	/** Why an enabled mail server isn't run, or null when it should be. */
	#stoppedReason(hostname: string | null, mailboxes: number): string | null {
		if (!hostname) {
			return "Set the mail server's hostname first.";
		}
		if (mailboxes === 0) {
			return "docker-mailserver won't start without a mailbox: add one.";
		}
		return null;
	}

	/**
	 * Turns the mail server on or off, and on, makes sure its hostname has
	 * an address record. The container itself is reconciled by the `sync`
	 * job the caller queues.
	 */
	async setEnabled(enabled: boolean): Promise<void> {
		await (
			await InstanceSettingsDTO.get()
		).persistCoreServices({ mailEnabled: enabled });
		const hostname = await this.hostname();
		if (enabled && hostname) {
			void syncCoreHostDns("Mail", null, hostname);
		}
	}

	/** Why `host` can't be the mail hostname, or null. */
	hostnameProblem(host: string): string | null {
		const trimmed = host.trim().toLowerCase();
		if (!trimmed) {
			return config.baseDomain
				? null
				: "Set a hostname, there's no base domain to default to.";
		}
		return DOMAIN_RE.test(trimmed)
			? null
			: "That isn't a hostname, e.g. mail.example.com.";
	}

	/**
	 * Saves the mail hostname (empty means `mail.` the base domain) and
	 * moves its address record.
	 *
	 * @throws When it isn't a hostname.
	 */
	async setHostname(host: string): Promise<void> {
		const problem = this.hostnameProblem(host);
		if (problem) {
			throw new Error(problem);
		}
		const previous = await this.hostname();
		await (
			await InstanceSettingsDTO.get()
		).persistCoreServices({
			mailHostname: host.trim().toLowerCase() || null,
		});
		const next = await this.hostname();
		if ((await InstanceSettingsDTO.get()).toJSON().mailEnabled === true) {
			void syncCoreHostDns("Mail", previous, next);
		}
	}

	/** The config files docker-mailserver reads, rendered from the database. */
	async #configFiles(): Promise<MailConfigFile[]> {
		const [domains, mailboxes, aliases] = await Promise.all([
			MailDomainDTO.list(),
			MailMailboxDTO.list(),
			MailAliasDTO.list(),
		]);
		const active = mailboxes.filter((box) => box.toJSON().enabled);
		const entries: MailboxEntry[] = active.map((box) => ({
			address: box.address,
			passwordHash: box.passwordHash,
			quotaMb: box.toJSON().quotaMb,
		}));
		const aliasEntries: AliasEntry[] = aliases
			.filter((alias) => alias.toJSON().enabled)
			.map((alias) => ({
				destinations: alias.toJSON().destinations,
				source: alias.address,
			}));
		const aliased = new Set(aliasEntries.map((alias) => alias.source));
		const catchAll = new Set(
			aliases
				.filter((alias) => alias.toJSON().enabled && !alias.toJSON().localPart)
				.map((alias) => alias.domain),
		);
		for (const box of active) {
			if (catchAll.has(box.domain) && !aliased.has(box.address)) {
				aliasEntries.push({ destinations: [box.address], source: box.address });
			}
		}
		const files: MailConfigFile[] = [
			{ content: postfixAccounts(entries), path: "postfix-accounts.cf" },
			{ content: postfixVirtual(aliasEntries), path: "postfix-virtual.cf" },
			{ content: dovecotQuotas(entries), path: "dovecot-quotas.cf" },
			{
				content: dkimSigningConf(MAIL_CONFIG_DIR),
				path: "rspamd/override.d/dkim_signing.conf",
			},
		];
		for (const domain of domains) {
			const key = domain.dkimPrivateKey();
			if (!key) {
				logger.warn(`Couldn't decrypt ${domain.name}'s DKIM key, skipped.`);
				continue;
			}
			files.push({
				content: key,
				path: dkimKeyPath(domain.name, domain.toJSON().dkimSelector),
			});
		}
		return files;
	}

	/**
	 * Writes every config file from the database, then brings the container
	 * in line: running when the server is on, has a hostname and at least
	 * one enabled mailbox, removed otherwise. `purge` names maildirs
	 * (`domain` or `domain/local`) of deleted mailboxes and domains to wipe.
	 *
	 * @throws When the config can't be written or the container won't start.
	 */
	async sync(
		purge: string[] = [],
		log?: (line: string) => Promise<void>,
	): Promise<void> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		const hostname = await this.hostname();
		const mailboxes = (await MailMailboxDTO.list()).filter(
			(box) => box.toJSON().enabled,
		).length;
		const reason = this.#stoppedReason(hostname, mailboxes);
		const off = row.mailEnabled !== true || !hostname || reason !== null;
		if (off) {
			if (reason && row.mailEnabled === true) {
				await log?.(reason);
			}
			await DockerService.reconcileMail(null);
			await PangolinMailPorts.remove();
		}
		const files = await this.#configFiles();
		await log?.("Writing the mail server's config files.");
		await DockerService.writeMailConfig(files);
		const purgeable = purge.filter(isPurgeablePath);
		if (purgeable.length > 0) {
			await log?.(`Wiping ${purgeable.join(", ")}.`);
			await DockerService.purgeMailDirs(purgeable);
		}
		if (!off && hostname) {
			await this.#start(hostname, log);
			await this.#publishThroughPangolin(log);
		}
	}

	/** Publishes the mail ports through Pangolin when it routes this instance, logging each port's outcome. */
	async #publishThroughPangolin(
		log?: (line: string) => Promise<void>,
	): Promise<void> {
		const results = await PangolinMailPorts.sync().catch((err: unknown) => [
			{
				detail: err instanceof Error ? err.message : String(err),
				ok: false,
				port: 0,
			},
		]);
		for (const result of results ?? []) {
			// oxlint-disable-next-line no-await-in-loop -- log lines keep their order
			await log?.(
				`Pangolin${result.port ? ` (${result.port})` : ""}: ${result.ok ? "" : "failed, "}${result.detail}`,
			);
		}
	}

	/**
	 * Creates or updates the mail container for `hostname`, with TLS only
	 * when Traefik's `acme.json` really holds a certificate for it:
	 * docker-mailserver told to use a missing one exits and restarts forever.
	 *
	 * @throws When the container won't start.
	 */
	async #start(
		hostname: string,
		log?: (line: string) => Promise<void>,
	): Promise<void> {
		const certSource = await DockerService.mailCertSource().catch(() => null);
		const certDomain = certSource
			? await DockerService.mailCertDomain(certSource, hostname).catch(
					() => null,
				)
			: null;
		if (!certSource) {
			await log?.(
				"Traefik's acme.json wasn't found: the mail server runs without TLS, and mail clients won't sign in.",
			);
		} else if (
			!certDomain &&
			config.pangolinEnabled &&
			!mailCertResolver(hostname)
		) {
			await log?.(
				`Behind Pangolin, Traefik can only get ${hostname}'s certificate over DNS-01: tick Issue certificates through DNS (DNS-01) on its domain under DNS. Until then the mail server runs without TLS.`,
			);
		} else if (!certDomain) {
			await log?.(
				`Traefik holds no certificate for ${hostname} yet: the mail server runs without TLS until it does, and turns it on by itself within a few minutes of it appearing.`,
			);
		}
		await log?.("Starting or updating the mail server's container.");
		const warning = await DockerService.reconcileMail({
			certDomain,
			certSource,
			hostname,
			postmaster: postmasterFor(hostname),
		});
		if (warning) {
			await log?.(warning);
		}
	}

	/**
	 * Brings a mail server that should run in line with its settings without
	 * rewriting its config: recreated when it's missing, or when Traefik's
	 * certificate for it appeared since it started without TLS.
	 */
	async reconcile(): Promise<void> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		const hostname = await this.hostname();
		const mailboxes = (await MailMailboxDTO.list()).filter(
			(box) => box.toJSON().enabled,
		).length;
		if (
			row.mailEnabled !== true ||
			!hostname ||
			this.#stoppedReason(hostname, mailboxes)
		) {
			return;
		}
		await this.#start(hostname);
	}

	/**
	 * Restarts the mail container.
	 *
	 * @throws When it doesn't exist or Docker refuses.
	 */
	async restart(): Promise<void> {
		if (!(await DockerService.mailHealth()).exists) {
			throw new Error("The mail server isn't running: turn it on first.");
		}
		await DockerService.restartMail();
	}

	/** Brings the mail server back after a worker restart. */
	async reassert(): Promise<void> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		if (row.mailEnabled !== true) {
			return;
		}
		await this.sync();
		const hostname = await this.hostname();
		if (hostname) {
			void syncCoreHostDns("Mail", null, hostname);
		}
	}

	/** The DNS page's domains that aren't mail domains yet and can be one (no wildcard), with whether a provider manages their records. */
	async availableDomains(): Promise<
		{ id: string; linked: boolean; name: string }[]
	> {
		const taken = new Set((await MailDomainDTO.list()).map((d) => d.name));
		return (await DomainDTO.list())
			.map((domain) => domain.toJSON())
			.filter((row) => !taken.has(row.name) && DOMAIN_RE.test(row.name))
			.map((row) => ({
				id: row.id,
				linked: Boolean(row.connectionId && row.zoneId),
				name: row.name,
			}));
	}

	/**
	 * Adds one of the DNS page's domains as a mail domain, with a fresh
	 * 2048-bit DKIM key pair and a `postmaster@` alias forwarding to the
	 * adding user's email, the address RFC 5321 requires every domain to
	 * accept.
	 *
	 * @throws When the domain isn't on the DNS page or is already added.
	 */
	async createDomain(
		dnsDomainId: string,
		user: { email: string; id: string },
	): Promise<MailDomainDTO> {
		const dnsDomain = await DomainDTO.get(dnsDomainId);
		if (!dnsDomain) {
			throw new Error("Pick one of the domains on the DNS page.");
		}
		const domain = dnsDomain.toJSON().name;
		if (!DOMAIN_RE.test(domain)) {
			throw new Error(`${domain} can't be a mail domain, pick a plain domain.`);
		}
		if (await MailDomainDTO.getByName(domain)) {
			throw new Error(`${domain} is already a mail domain.`);
		}
		const { privateKey, publicKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { format: "pem", type: "pkcs8" },
			publicKeyEncoding: { format: "der", type: "spki" },
		});
		const created = await MailDomainDTO.create({
			dkimPrivateKey: privateKey,
			dkimPublicKey: publicKey.toString("base64"),
			dkimSelector: DKIM_SELECTOR,
			name: domain,
			userId: user.id,
		});
		const postmaster = mailAddress("postmaster", domain);
		if (user.email.toLowerCase() !== postmaster) {
			await MailAliasDTO.create({
				destinations: [user.email],
				domain,
				domainId: created.id,
				enabled: true,
				localPart: "postmaster",
			});
		}
		return created;
	}

	/**
	 * Whether `address` is already taken by a mailbox or an alias, other
	 * than the row `exceptId`.
	 */
	async #addressTaken(address: string, exceptId?: string): Promise<boolean> {
		const [mailboxes, aliases] = await Promise.all([
			MailMailboxDTO.list(),
			MailAliasDTO.list(),
		]);
		return (
			mailboxes.some(
				(box) => box.address === address && box.toJSON().id !== exceptId,
			) ||
			aliases.some(
				(alias) => alias.address === address && alias.toJSON().id !== exceptId,
			)
		);
	}

	/** A bcrypt hash of `password` in the `$2y$` spelling Dovecot's BLF-CRYPT expects. */
	async #hash(password: string): Promise<string> {
		const hash = await Bun.password.hash(password, {
			algorithm: "bcrypt",
			cost: BCRYPT_COST,
		});
		return hash.replace(BCRYPT_PREFIX_RE, () => "$2y$");
	}

	/**
	 * Adds a mailbox.
	 *
	 * @throws When the domain is gone, the name or password is refused, or the address is taken.
	 */
	async createMailbox(
		input: MailboxInput & {
			domainId: string;
			localPart: string;
			password: string;
		},
	): Promise<MailMailboxDTO> {
		const domain = await MailDomainDTO.get(input.domainId);
		if (!domain) {
			throw new Error("Pick a mail domain.");
		}
		const localPart = input.localPart.trim().toLowerCase();
		const problem =
			localPartProblem(localPart) ?? mailPasswordProblem(input.password);
		if (problem) {
			throw new Error(problem);
		}
		const address = mailAddress(localPart, domain.name);
		if (await this.#addressTaken(address)) {
			throw new Error(`${address} is already a mailbox or an alias.`);
		}
		return await MailMailboxDTO.create({
			displayName: input.displayName,
			domain: domain.name,
			domainId: domain.id,
			enabled: input.enabled,
			localPart,
			passwordHash: await this.#hash(input.password),
			quotaMb: input.quotaMb,
		});
	}

	/**
	 * Sets a mailbox's password.
	 *
	 * @throws When the password is refused.
	 */
	async setMailboxPassword(
		mailbox: MailMailboxDTO,
		password: string,
	): Promise<void> {
		const problem = mailPasswordProblem(password);
		if (problem) {
			throw new Error(problem);
		}
		await mailbox.setPasswordHash(await this.#hash(password));
	}

	/**
	 * Adds an alias; an empty local part makes it the domain's catch-all.
	 *
	 * @throws When the domain is gone, the name or a destination is refused, or the address is taken.
	 */
	async createAlias(input: {
		destinations: string[];
		domainId: string;
		enabled: boolean;
		localPart: string;
	}): Promise<MailAliasDTO> {
		const domain = await MailDomainDTO.get(input.domainId);
		if (!domain) {
			throw new Error("Pick a mail domain.");
		}
		const localPart = input.localPart.trim().toLowerCase();
		const problem =
			localPartProblem(localPart, true) ??
			this.destinationsProblem(input.destinations);
		if (problem) {
			throw new Error(problem);
		}
		const address = mailAddress(localPart, domain.name);
		if (await this.#addressTaken(address)) {
			throw new Error(`${address} is already a mailbox or an alias.`);
		}
		return await MailAliasDTO.create({
			destinations: input.destinations,
			domain: domain.name,
			domainId: domain.id,
			enabled: input.enabled,
			localPart,
		});
	}

	/** Why an alias's destination list is refused, or null. */
	destinationsProblem(destinations: string[]): string | null {
		if (destinations.length === 0) {
			return "Give it at least one address to forward to.";
		}
		const bad = destinations.find((destination) => !isMailAddress(destination));
		return bad ? `${bad} isn't an email address.` : null;
	}

	/**
	 * Every mailbox's used space and quota, read from Dovecot. Empty when
	 * the server isn't running or Dovecot doesn't answer.
	 */
	async usage(): Promise<Record<string, MailboxUsage>> {
		if (!(await DockerService.mailRunning().catch(() => false))) {
			return {};
		}
		const result = await DockerService.execInMail([
			"doveadm",
			"-f",
			"tab",
			"quota",
			"get",
			"-A",
		]).catch(() => null);
		if (!result || result.exitCode !== 0) {
			return {};
		}
		const usage: Record<string, MailboxUsage> = {};
		for (const line of result.stdout.split("\n").slice(1)) {
			const [user, , type, value, limit] = line.split(TAB_RE);
			if (!user || type !== "STORAGE") {
				continue;
			}
			const limitKb = Number(limit);
			usage[user] = {
				limitMb:
					Number.isFinite(limitKb) && limitKb > 0 ? limitKb / KB_PER_MB : null,
				usedMb: Number(value) / KB_PER_MB || 0,
			};
		}
		return usage;
	}

	/** The records a domain needs, the mail host's address record first. */
	async records(domain: MailDomainDTO): Promise<MailDnsRecord[]> {
		const hostname = await this.hostname();
		if (!hostname) {
			return [];
		}
		const row = domain.toJSON();
		return [
			{
				content: "",
				name: hostname,
				priority: null,
				purpose: "The mail server's own address, created with the hostname",
				type: "A",
			},
			...requiredMailRecords(domain.name, hostname, {
				publicKey: row.dkimPublicKey,
				selector: row.dkimSelector,
			}),
		];
	}

	/** Each required record's state as public resolvers see it now. */
	async checkRecords(domain: MailDomainDTO): Promise<MailRecordCheck[]> {
		const resolver = new Resolver({ timeout: 3000, tries: 2 });
		resolver.setServers(PUBLIC_RESOLVERS);
		const records = await this.records(domain);
		return await Promise.all(
			records.map(async (record) => {
				const found = await resolveValues(resolver, record.name, record.type);
				const state =
					record.type === "A" && !record.content
						? found.length > 0
							? "ok"
							: "missing"
						: mailRecordState(record, found);
				return { found, record, state };
			}),
		);
	}

	/** The DNS domain Homerun manages that covers a mail domain, null when none is linked to a provider. */
	async dnsDomain(domain: MailDomainDTO): Promise<DomainDTO | null> {
		const managed = await DomainDTO.forHostname(domain.name);
		const row = managed?.toJSON();
		return managed && row?.connectionId && managed.zone() ? managed : null;
	}

	/**
	 * Creates or corrects the domain's MX, SPF, DKIM and DMARC records at its
	 * DNS provider, and the mail host's address record.
	 *
	 * @returns One line per record.
	 * @throws When no managed domain covers it, or the provider refuses.
	 */
	async publishRecords(domain: MailDomainDTO): Promise<string[]> {
		const managed = await this.dnsDomain(domain);
		if (!managed) {
			throw new Error(
				`${domain.name} isn't under a domain linked to a DNS provider on the DNS page.`,
			);
		}
		const hostname = await this.hostname();
		if (hostname) {
			void syncCoreHostDns("Mail", null, hostname);
		}
		const existing = await DomainDnsService.records(managed);
		const wanted = (await this.records(domain)).filter(
			(record) => record.type !== "A",
		);
		const lines: string[] = [];
		for (const record of wanted) {
			const input: DnsRecordInput = {
				content: record.content,
				name: record.name,
				priority: record.priority,
				type: record.type,
			};
			const sameName = existing.filter(
				(candidate) =>
					normalizeName(candidate.name) === normalizeName(record.name) &&
					candidate.type === record.type,
			);
			const state = mailRecordState(
				record,
				sameName.map((candidate) => candidate.content),
			);
			if (state === "ok") {
				lines.push(`${record.type} ${record.name}: already set`);
				continue;
			}
			const kind =
				record.content.split(";")[0]?.split(" ")[0]?.toLowerCase() ?? "";
			const replaceable = sameName.find((candidate) =>
				record.type === "MX"
					? normalizeName(candidate.content) === normalizeName(record.content)
					: candidate.content.toLowerCase().startsWith(kind),
			);
			if (replaceable) {
				// oxlint-disable-next-line no-await-in-loop -- one provider call at a time, some rate-limit hard
				await DomainDnsService.updateRecord(managed, replaceable.id, input);
				lines.push(`${record.type} ${record.name}: updated`);
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- one provider call at a time, some rate-limit hard
			await DomainDnsService.createRecord(managed, input);
			lines.push(`${record.type} ${record.name}: created`);
		}
		logger.info(`Mail records for ${domain.name}: ${lines.join(", ")}`);
		return lines;
	}
}

export const MailService = new MailServiceClass();
