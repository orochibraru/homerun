import { config } from "#lib/config.js";
import { MAIL_PORTS } from "#lib/mail.js";

import { certResolverFor } from "./cert-resolver.ts";
import { MIRROR_LABEL } from "./image-scan-refs.ts";

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
export const MAIL_CONFIG_MOUNT = "/cfg";

const ACME_FILE = "acme.json";
const TRAILING_SLASH_RE = /\/$/;

export interface MailConfigFile {
	content: string;
	path: string;
}

/** How the mail server container should currently be configured. */
export interface MailDesiredState {
	certSource: string | null;
	hostname: string;
	postmaster: string;
}

export interface InspectedMount {
	Destination?: string;
	Name?: string;
	Source?: string;
	Type?: string;
}

/**
 * The volume (or host directory) holding Traefik's `acme.json` for
 * `resolver`, read off Traefik's command line and mounts, so the mail server
 * can mount it and reuse the certificate Traefik issues for its hostname.
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
			return mount.Type === "volume"
				? (mount.Name ?? null)
				: (mount.Source ?? null);
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
		`SSL_TYPE=${state.certSource ? "letsencrypt" : ""}`,
		`SSL_DOMAIN=${state.hostname}`,
	];
}

/**
 * The container's labels: its infra marker and a Traefik router for the
 * mail hostname. Nothing is served over HTTP there, the router only exists
 * so Traefik issues the certificate the mail server then reads from
 * `acme.json`.
 */
export function mailLabels(state: MailDesiredState): Record<string, string> {
	const resolver = certResolverFor(
		state.hostname,
		config.traefik.certResolver,
		config.pangolinEnabled,
		config.traefik.instanceCertNames,
	);
	const labels: Record<string, string> = {
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

/** The container's volume binds, Traefik's certificate store read-only when there is one. */
export function mailBinds(state: MailDesiredState): string[] {
	const binds = [
		`${MAIL_DATA_VOLUME}:${MAIL_DATA_DIR}`,
		`${MAIL_STATE_VOLUME}:${MAIL_STATE_DIR}`,
		`${MAIL_LOG_VOLUME}:${MAIL_LOG_DIR}`,
		`${MAIL_CONFIG_VOLUME}:${MAIL_CONFIG_DIR}`,
	];
	if (state.certSource) {
		binds.push(`${state.certSource}:${MAIL_CERT_DIR}:ro`);
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
		[...Object.keys(labels), ...Object.keys(wanted)].filter((key) =>
			key.startsWith("traefik."),
		),
	);
	return [...traefikKeys].every((key) => labels[key] === wanted[key]);
}

/** The shell script writing `files` under the config mount, each through a temp file and a rename so docker-mailserver's change detector never reads half of one. */
export function mailConfigScript(files: MailConfigFile[]): string {
	return [
		"set -e",
		`rm -rf ${MAIL_CONFIG_MOUNT}/rspamd/dkim`,
		...files.map((file, index) => {
			const target = `${MAIL_CONFIG_MOUNT}/${file.path}`;
			return `mkdir -p "$(dirname '${target}')" && printf '%s' "$MAIL_FILE_${index}" > '${target}.tmp' && mv '${target}.tmp' '${target}'`;
		}),
	].join("\n");
}
