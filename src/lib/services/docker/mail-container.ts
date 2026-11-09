import { challengeDomainFor, DNS_CHALLENGE_RESOLVER } from "#lib/acme-dns.js";
import { config } from "#lib/config.js";
import { MAIL_PORTS, type MailRelay } from "#lib/mail.js";

import { certResolverFor } from "./cert-resolver.ts";
import { MIRROR_LABEL } from "./image-scan-refs.ts";
import { CORE_LABEL } from "./newt.ts";

export const MAIL_CONTAINER_NAME = "homerun-mail";
export const MAIL_IMAGE = "ghcr.io/docker-mailserver/docker-mailserver";
export const MAIL_IMAGE_TAG = "15.1.0";
export const MAIL_CONFIG_DIR = "/tmp/docker-mailserver";
export const MAIL_DATA_DIR = "/var/mail";
export const MAIL_STATE_DIR = "/var/mail-state";
export const MAIL_LOG_DIR = "/var/log/mail";
export const MAIL_CERT_DIR = "/etc/letsencrypt";
export const MAIL_CONFIG_VOLUME = "homerun-mail-config";
export const MAIL_DATA_VOLUME = "homerun-mail-data";
export const MAIL_STATE_VOLUME = "homerun-mail-state";
export const MAIL_LOG_VOLUME = "homerun-mail-logs";
export const MAIL_ROUTER = "homerun-mail";
export const MAIL_ALIAS_LABEL = "homerun.mail.alias";
export const MAIL_CONFIG_MOUNT = "/cfg";
export const MAIL_REVISION_LABEL = "homerun.mail.revision";
export const MAIL_REVISION = "2";
export const MAIL_PROXY_PORTS: Record<number, number> = {
	25: 12_525,
	465: 12_465,
	587: 12_587,
	993: 12_993,
};

const ACME_FILE = "acme.json";
const TRAILING_SLASH_RE = /\/$/;

export interface MailConfigFile {
	content: string;
	path: string;
}

/** How the mail server container should currently be configured. */
export interface MailDesiredState {
	certDomain: string | null;
	certSource: string | null;
	hostname: string;
	postmaster: string;
	relay: MailRelay | null;
}

export interface InspectedMount {
	Destination?: string;
	Name?: string;
	Source?: string;
	Type?: string;
}

/**
 * The host directory holding Traefik's `acme.json` for `resolver`, read off
 * Traefik's command line and mounts, so the mail server can mount the file and
 * reuse the certificate Traefik issues for its hostname. A volume's host path,
 * not its name: a named volume can't be bound one file at a time.
 * Null when the storage file isn't called `acme.json` at the root of a mount,
 * which docker-mailserver can't read.
 */
export function acmeSourceFrom(
	cmd: string[],
	mounts: InspectedMount[],
	resolver: string,
): string | null {
	const prefix =
		`--certificatesresolvers.${resolver}.acme.storage=`.toLowerCase();
	const flag = cmd.find((arg) => arg.toLowerCase().startsWith(prefix));
	const storage = flag ? flag.slice(prefix.length) : ACME_FILE;
	for (const mount of mounts) {
		const destination = mount.Destination?.replace(TRAILING_SLASH_RE, "");
		if (destination && storage === `${destination}/${ACME_FILE}`) {
			return mount.Source ?? null;
		}
	}
	return null;
}

interface AcmeStore {
	Certificates?: { domain?: { main?: string; sans?: string[] } }[] | null;
}

function certCovers(name: string, hostname: string): boolean {
	const lower = name.toLowerCase();
	if (lower === hostname) {
		return true;
	}
	if (!lower.startsWith("*.")) {
		return false;
	}
	const rest = hostname.slice(hostname.indexOf(".") + 1);
	return hostname.includes(".") && lower.slice(2) === rest;
}

/**
 * The `main` name of the certificate in Traefik's `acme.json` that covers
 * `hostname`, exactly or through a wildcard, which is the name
 * docker-mailserver looks the certificate up by. Null when there's none, or
 * the file isn't JSON: docker-mailserver panics and restarts forever when
 * told to use a certificate that isn't there.
 */
export function acmeCertDomain(
	acmeJson: string,
	hostname: string,
): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(acmeJson);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const host = hostname.toLowerCase();
	for (const store of Object.values(parsed as Record<string, AcmeStore>)) {
		for (const cert of store?.Certificates ?? []) {
			const main = cert.domain?.main;
			const names = [main, ...(cert.domain?.sans ?? [])].filter(
				(name): name is string => typeof name === "string",
			);
			if (main && names.some((name) => certCovers(name, host))) {
				return main;
			}
		}
	}
	return null;
}

/**
 * docker-mailserver's environment: rspamd for spam filtering and DKIM
 * signing (OpenDKIM, OpenDMARC, SpamAssassin and Amavis off, ClamAV off to
 * keep it under a gigabyte of memory), quotas on, and TLS from Traefik's
 * `acme.json` when there's one to mount.
 */
export function mailEnv(state: MailDesiredState): string[] {
	return [
		`OVERRIDE_HOSTNAME=${state.hostname}`,
		`POSTMASTER_ADDRESS=${state.postmaster}`,
		"ONE_DIR=1",
		"ENABLE_RSPAMD=1",
		"ENABLE_OPENDKIM=0",
		"ENABLE_OPENDMARC=0",
		"ENABLE_POLICYD_SPF=0",
		"ENABLE_AMAVIS=0",
		"ENABLE_SPAMASSASSIN=0",
		"ENABLE_CLAMAV=0",
		"ENABLE_FAIL2BAN=0",
		"ENABLE_QUOTAS=1",
		"ENABLE_POP3=0",
		"ENABLE_MANAGESIEVE=0",
		"RSPAMD_LEARN=1",
		"MOVE_SPAM_TO_JUNK=1",
		"SPOOF_PROTECTION=1",
		"PERMIT_DOCKER=none",
		`SSL_TYPE=${state.certSource && state.certDomain ? "letsencrypt" : ""}`,
		`SSL_DOMAIN=${state.certDomain ?? state.hostname}`,
		`RELAY_HOST=${state.relay?.host ?? ""}`,
		`RELAY_PORT=${state.relay ? String(state.relay.port) : ""}`,
		`RELAY_USER=${state.relay?.user ?? ""}`,
		`RELAY_PASSWORD=${state.relay?.password ?? ""}`,
	];
}

/**
 * docker-mailserver's `user-patches.sh`, run once at startup: a copy of the
 * SMTP, submission and submissions services on the PROXY protocol ports, so
 * Pangolin can hand over the real client address there while the usual ports
 * keep serving direct and in-network connections.
 */
export function mailProxyUserPatches(): string {
	return [
		"#!/bin/bash",
		"set -eu",
		"clone() {",
		'\tlocal port="$1" option="$2" name entry',
		"\tshift 2",
		'\tfor name in "$@"; do',
		'\t\tentry="$(postconf -M "$name/inet" 2>/dev/null | sed "s/^[^ ]* //")"',
		'\t\t[ -n "$entry" ] || continue',
		'\t\tpostconf -M "$port/inet=$port $entry"',
		'\t\tpostconf -P "$port/inet/$option=haproxy"',
		'\t\tpostconf -P "$port/inet/syslog_name=postfix/$name-proxy"',
		"\t\treturn",
		"\tdone",
		"}",
		`clone ${MAIL_PROXY_PORTS[25]} postscreen_upstream_proxy_protocol smtp`,
		`clone ${MAIL_PROXY_PORTS[587]} smtpd_upstream_proxy_protocol submission`,
		`clone ${MAIL_PROXY_PORTS[465]} smtpd_upstream_proxy_protocol submissions smtps`,
		"",
	].join("\n");
}

/** docker-mailserver's `dovecot.cf`: an IMAPS listener on the PROXY protocol port, trusting the PROXY header from private networks only, where the tunnel connects from. */
export function mailProxyDovecotConf(): string {
	return [
		"haproxy_trusted_networks = 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fd00::/8",
		"service imap-login {",
		"  inet_listener imaps_proxy {",
		"    haproxy = yes",
		`    port = ${MAIL_PROXY_PORTS[993]}`,
		"    ssl = yes",
		"  }",
		"}",
		"",
	].join("\n");
}

/**
 * The resolver the mail hostname's certificate comes from. Behind Pangolin
 * HTTP-01 can't reach this host, so only DNS-01 works, and only when a
 * domain covering the hostname has DNS challenge on; wildcard routers aren't
 * written there, so the mail router asks for its own name.
 */
export function mailCertResolver(hostname: string): string | null {
	if (!config.pangolinEnabled) {
		return certResolverFor(
			hostname,
			config.traefik.certResolver,
			false,
			config.traefik.instanceCertNames,
		);
	}
	return challengeDomainFor(hostname, config.traefik.dnsChallengeDomains)
		? DNS_CHALLENGE_RESOLVER
		: null;
}

/**
 * The container's labels: its infra marker and a Traefik router for the
 * mail hostname. Nothing is served over HTTP there, the router only exists
 * so Traefik issues the certificate the mail server then reads from
 * `acme.json`.
 */
export function mailLabels(state: MailDesiredState): Record<string, string> {
	const resolver = mailCertResolver(state.hostname);
	const labels: Record<string, string> = {
		[CORE_LABEL]: "mail",
		[MAIL_ALIAS_LABEL]: state.hostname,
		[MAIL_REVISION_LABEL]: MAIL_REVISION,
		[MIRROR_LABEL]: "mail",
		"traefik.enable": "true",
		[`traefik.http.routers.${MAIL_ROUTER}.entrypoints`]:
			config.traefik.entrypoint,
		[`traefik.http.routers.${MAIL_ROUTER}.rule`]: `Host(\`${state.hostname}\`)`,
		[`traefik.http.routers.${MAIL_ROUTER}.service`]: "noop@internal",
		[`traefik.http.routers.${MAIL_ROUTER}.tls`]: "true",
	};
	if (resolver) {
		labels[`traefik.http.routers.${MAIL_ROUTER}.tls.certresolver`] = resolver;
	}
	return labels;
}

/**
 * The container's volume binds, plus Traefik's `acme.json` read-only when there
 * is one. Only the file: docker-mailserver writes the extracted certificate
 * next to it, so `/etc/letsencrypt` itself must stay writable.
 */
export function mailBinds(state: MailDesiredState): string[] {
	const binds = [
		`${MAIL_DATA_VOLUME}:${MAIL_DATA_DIR}`,
		`${MAIL_STATE_VOLUME}:${MAIL_STATE_DIR}`,
		`${MAIL_LOG_VOLUME}:${MAIL_LOG_DIR}`,
		`${MAIL_CONFIG_VOLUME}:${MAIL_CONFIG_DIR}`,
	];
	if (state.certSource && state.certDomain) {
		binds.push(
			`${state.certSource}/${ACME_FILE}:${MAIL_CERT_DIR}/${ACME_FILE}:ro`,
		);
	}
	return binds;
}

/** The mail ports, published on every host address. */
export function mailPortBindings(): Record<string, { HostPort: string }[]> {
	return Object.fromEntries(
		MAIL_PORTS.map(({ port }) => [`${port}/tcp`, [{ HostPort: String(port) }]]),
	);
}

/**
 * Whether a running container already matches `state`'s environment,
 * Traefik labels and binds, so it can be left alone. Anything else Docker
 * adds is ignored.
 */
export function mailMatches(
	env: string[],
	labels: Record<string, string>,
	binds: string[],
	state: MailDesiredState,
): boolean {
	if (!mailEnv(state).every((entry) => env.includes(entry))) {
		return false;
	}
	const wantedBinds = mailBinds(state);
	if (
		wantedBinds.length !== binds.length ||
		!wantedBinds.every((bind) => binds.includes(bind))
	) {
		return false;
	}
	const wanted = mailLabels(state);
	const traefikKeys = new Set(
		[...Object.keys(labels), ...Object.keys(wanted)].filter(
			(key) =>
				key.startsWith("traefik.") ||
				key === MAIL_ALIAS_LABEL ||
				key === MAIL_REVISION_LABEL,
		),
	);
	return [...traefikKeys].every((key) => labels[key] === wanted[key]);
}

/** The shell script writing `files` under the config mount, each through a temp file and a rename so docker-mailserver's change detector never reads half of one, scripts made executable. */
export function mailConfigScript(files: MailConfigFile[]): string {
	return [
		"set -e",
		`rm -rf ${MAIL_CONFIG_MOUNT}/rspamd/dkim`,
		...files.map((file, index) => {
			const target = `${MAIL_CONFIG_MOUNT}/${file.path}`;
			const executable = file.path.endsWith(".sh")
				? ` && chmod 755 '${target}'`
				: "";
			return `mkdir -p "$(dirname '${target}')" && printf '%s' "$MAIL_FILE_${index}" > '${target}.tmp' && mv '${target}.tmp' '${target}'${executable}`;
		}),
	].join("\n");
}
