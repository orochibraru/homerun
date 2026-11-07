export const DKIM_SELECTOR = "mail";
export const MAIL_PASSWORD_MIN_LENGTH = 10;
export const MAIL_PASSWORD_MAX_BYTES = 72;
export const MAIL_PORTS = [
	{ label: "SMTP (incoming mail)", port: 25 },
	{ label: "SMTP submission, implicit TLS", port: 465 },
	{ label: "SMTP submission, STARTTLS", port: 587 },
	{ label: "IMAP, implicit TLS", port: 993 },
] as const;

const MAIL_DOMAIN_RE =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;
const ADDRESS_RE =
	/^[a-z0-9._+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const WHITESPACE_RE = /\s+/g;
const TRAILING_DOT_RE = /\.$/;
const LIST_SEPARATOR_RE = /[\s,;]+/;

export interface MailboxEntry {
	address: string;
	passwordHash: string;
	quotaMb: number | null;
}

export interface AliasEntry {
	destinations: string[];
	source: string;
}

export interface MailDnsRecord {
	content: string;
	name: string;
	priority: number | null;
	purpose: string;
	type: "A" | "MX" | "TXT";
}

export type MailRecordState = "different" | "missing" | "ok";

/** A mailbox or alias address, `@domain` for a catch-all alias with no local part. */
export function mailAddress(localPart: string, domain: string): string {
	return localPart ? `${localPart}@${domain}` : `@${domain}`;
}

/** Why `value` can't be the part before the `@`, or null when it can. An empty one is allowed only when `allowEmpty` (a catch-all). */
export function localPartProblem(
	value: string,
	allowEmpty = false,
): string | null {
	if (!value) {
		return allowEmpty ? null : "Give it a name, the part before the @.";
	}
	return LOCAL_PART_RE.test(value)
		? null
		: "Use lowercase letters, digits, dots, dashes, plus or underscores, starting and ending with a letter or digit.";
}

/** Whether `value` is a full lowercase email address. */
export function isMailAddress(value: string): boolean {
	return ADDRESS_RE.test(value);
}

/** Why `password` can't be a mailbox password, or null. bcrypt only reads the first 72 bytes, so longer ones are refused rather than silently cut. */
export function mailPasswordProblem(password: string): string | null {
	if (password.length < MAIL_PASSWORD_MIN_LENGTH) {
		return `Use at least ${MAIL_PASSWORD_MIN_LENGTH} characters.`;
	}
	if (new TextEncoder().encode(password).length > MAIL_PASSWORD_MAX_BYTES) {
		return `Use at most ${MAIL_PASSWORD_MAX_BYTES} bytes.`;
	}
	return null;
}

/** Splits a comma, space or newline separated list of destination addresses, lowercased and deduplicated. */
export function parseDestinations(raw: string): string[] {
	return [
		...new Set(
			raw
				.split(LIST_SEPARATOR_RE)
				.map((entry) => entry.trim().toLowerCase())
				.filter(Boolean),
		),
	];
}

/** docker-mailserver's `postfix-accounts.cf`: one `address|{BLF-CRYPT}hash` line per mailbox. */
export function postfixAccounts(mailboxes: MailboxEntry[]): string {
	return mailboxes
		.map((box) => `${box.address}|{BLF-CRYPT}${box.passwordHash}\n`)
		.join("");
}

/** docker-mailserver's `postfix-virtual.cf`: one `source destination,destination` line per alias. */
export function postfixVirtual(aliases: AliasEntry[]): string {
	return aliases
		.filter((alias) => alias.destinations.length > 0)
		.map((alias) => `${alias.source} ${alias.destinations.join(",")}\n`)
		.join("");
}

/** docker-mailserver's `dovecot-quotas.cf`: `address:<n>M` for each mailbox with a quota. */
export function dovecotQuotas(mailboxes: MailboxEntry[]): string {
	return mailboxes
		.filter((box) => box.quotaMb !== null)
		.map((box) => `${box.address}:${box.quotaMb}M\n`)
		.join("");
}

/** Where a domain's DKIM private key sits, relative to docker-mailserver's config directory. */
export function dkimKeyPath(domain: string, selector: string): string {
	return `rspamd/dkim/rsa-2048-${selector}-${domain}.private.txt`;
}

/** rspamd's DKIM signing override: every domain is signed with the key file its name and selector point at, so a new domain only needs its key written. */
export function dkimSigningConf(configDir: string): string {
	return [
		"enabled = true;",
		"sign_authenticated = true;",
		"sign_local = true;",
		'use_domain = "header";',
		"use_redis = false;",
		"use_esld = true;",
		"check_pubkey = false;",
		`selector = "${DKIM_SELECTOR}";`,
		`path = "${configDir}/rspamd/dkim/rsa-2048-$selector-$domain.private.txt";`,
		"",
	].join("\n");
}

/** The DKIM TXT value publishing a base64 SPKI public key. */
export function dkimRecordValue(publicKey: string): string {
	return `v=DKIM1; k=rsa; p=${publicKey}`;
}

/** The records a domain needs for mail to reach and leave this server: MX, SPF, DKIM, DMARC, plus the mail host's own address record. */
export function requiredMailRecords(
	domain: string,
	mailHost: string,
	dkim: { publicKey: string; selector: string },
): MailDnsRecord[] {
	return [
		{
			content: mailHost,
			name: domain,
			priority: 10,
			purpose: "Sends the domain's incoming mail to this server",
			type: "MX",
		},
		{
			content: "v=spf1 mx ~all",
			name: domain,
			priority: null,
			purpose: "SPF: lets the MX hosts send for the domain",
			type: "TXT",
		},
		{
			content: dkimRecordValue(dkim.publicKey),
			name: `${dkim.selector}._domainkey.${domain}`,
			priority: null,
			purpose: "DKIM: the key outgoing mail is signed with",
			type: "TXT",
		},
		{
			content: "v=DMARC1; p=quarantine; adkim=r; aspf=r",
			name: `_dmarc.${domain}`,
			priority: null,
			purpose: "DMARC: what receivers do with mail failing SPF and DKIM",
			type: "TXT",
		},
	];
}

/** What a TXT or MX record's value is recognised by, so a different value of the same kind reads as "different" rather than "missing". */
function recordKind(record: MailDnsRecord): string | null {
	if (record.type !== "TXT") {
		return null;
	}
	return record.content.split(";")[0]?.split(" ")[0]?.toLowerCase() ?? null;
}

/** Collapses whitespace and case so two spellings of one TXT value compare equal. */
function normalizeValue(value: string): string {
	return value
		.replace(WHITESPACE_RE, "")
		.replace(TRAILING_DOT_RE, "")
		.toLowerCase();
}

/**
 * How `found` (the values the name resolves to for that record's type, TXT
 * strings already joined) compares with what the record wants: `ok` when one
 * matches, `different` when there's a value of the same kind (another SPF, an
 * MX elsewhere), `missing` otherwise.
 */
export function mailRecordState(
	record: MailDnsRecord,
	found: string[],
): MailRecordState {
	const wanted = normalizeValue(record.content);
	const values = found.map(normalizeValue);
	if (values.includes(wanted)) {
		return "ok";
	}
	if (record.type === "MX" || record.type === "A") {
		return values.length > 0 ? "different" : "missing";
	}
	const kind = recordKind(record);
	if (kind === "v=spf1") {
		const spf = found.find((value) => value.toLowerCase().startsWith("v=spf1"));
		const tokens = spf?.toLowerCase().split(WHITESPACE_RE) ?? [];
		if (tokens.includes("mx") || tokens.includes("+mx")) {
			return "ok";
		}
	}
	return kind && values.some((value) => value.startsWith(kind))
		? "different"
		: "missing";
}

/** Whether `path` is a maildir to purge, `domain` or `domain/local`, and nothing that could climb out of the mail directory. */
export function isPurgeablePath(path: string): boolean {
	const [domain, local, ...rest] = path.split("/");
	return (
		rest.length === 0 &&
		domain !== undefined &&
		MAIL_DOMAIN_RE.test(domain) &&
		(local === undefined || localPartProblem(local) === null)
	);
}
