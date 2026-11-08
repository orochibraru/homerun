export interface MailFolder {
	guid: string;
	messages: number;
	name: string;
	sizeBytes: number;
	unseen: number;
}

export interface MailQuota {
	limitBytes: number | null;
	messageLimit: number | null;
	messages: number;
	usedBytes: number;
}

export type MailCheckState = "fail" | "ok" | "warn";

export interface MailCheck {
	detail: string;
	id: string;
	label: string;
	state: MailCheckState;
}

const TAB_RE = /\t/;
const KB = 1024;
const QUEUE_SUMMARY_RE = /in (\d+) Requests?\./i;

/** A number from doveadm's output, 0 for anything it printed instead (`-`, empty). */
function toNumber(value: string | undefined): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The folders in `doveadm -f tab mailbox status -u <user> "messages unseen vsize guid" "*"`,
 * INBOX first, then alphabetically. The GUID is what a folder is addressed by
 * afterwards, since a name with `*` or `%` in it reads as a pattern.
 */
export function parseMailboxStatus(output: string): MailFolder[] {
	const [header, ...lines] = output.trim().split("\n");
	const columns = header?.split(TAB_RE) ?? [];
	const index = (name: string) => columns.indexOf(name);
	return lines
		.map((line) => line.split(TAB_RE))
		.filter((cells) => cells[index("mailbox")])
		.map((cells) => ({
			guid: cells[index("guid")] ?? "",
			messages: toNumber(cells[index("messages")]),
			name: cells[index("mailbox")] ?? "",
			sizeBytes: toNumber(cells[index("vsize")]),
			unseen: toNumber(cells[index("unseen")]),
		}))
		.sort((a, b) =>
			a.name === "INBOX"
				? -1
				: b.name === "INBOX"
					? 1
					: a.name.localeCompare(b.name),
		);
}

/**
 * One user's storage and message counts from `doveadm -f tab quota get -u <user>`,
 * whose STORAGE row is in kilobytes. A limit of `-` or 0 means none.
 */
export function parseQuota(output: string): MailQuota {
	const quota: MailQuota = {
		limitBytes: null,
		messageLimit: null,
		messages: 0,
		usedBytes: 0,
	};
	const [header, ...lines] = output.trim().split("\n");
	const columns = header?.split(TAB_RE) ?? [];
	const at = (cells: string[], name: string) => cells[columns.indexOf(name)];
	for (const cells of lines.map((line) => line.split(TAB_RE))) {
		const limit = toNumber(at(cells, "Limit"));
		if (at(cells, "Type") === "STORAGE") {
			quota.usedBytes = toNumber(at(cells, "Value")) * KB;
			quota.limitBytes = limit > 0 ? limit * KB : null;
		}
		if (at(cells, "Type") === "MESSAGE") {
			quota.messages = toNumber(at(cells, "Value"));
			quota.messageLimit = limit > 0 ? limit : null;
		}
	}
	return quota;
}

/** How many messages Postfix's `mailq` says are waiting, 0 when the queue is empty. */
export function queuedMessages(mailq: string): number {
	if (mailq.toLowerCase().includes("mail queue is empty")) {
		return 0;
	}
	return Number(QUEUE_SUMMARY_RE.exec(mailq)?.[1] ?? 0);
}

/** Whether an SMTP server's first line is a ready greeting. */
export function isSmtpGreeting(line: string): boolean {
	return line.startsWith("220");
}

/** The worst state among `checks`, what the self-test reports overall. */
export function overallState(checks: MailCheck[]): MailCheckState {
	if (checks.some((check) => check.state === "fail")) {
		return "fail";
	}
	return checks.some((check) => check.state === "warn") ? "warn" : "ok";
}
