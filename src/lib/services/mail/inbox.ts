import type { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import {
	type MailFolder,
	type MailQuota,
	parseMailboxStatus,
	parseQuota,
} from "#lib/mail-doveadm.js";

import { DockerService } from "../docker.service.ts";

export interface MailboxContents {
	folders: MailFolder[];
	quota: MailQuota;
}

const SUBJECT_RE = /[\r\n]/g;

/**
 * Reads and tidies one mailbox's contents through Dovecot's `doveadm` inside
 * the mail container: its folders with their sizes, its quota, emptying a
 * folder, and sending a test message out from it.
 */
class MailInboxServiceClass {
	/** The mailbox's folders and quota; null when the server isn't running or Dovecot doesn't know the user yet. */
	async contents(mailbox: MailMailboxDTO): Promise<MailboxContents | null> {
		if (!(await DockerService.mailRunning().catch(() => false))) {
			return null;
		}
		const [status, quota] = await Promise.all([
			DockerService.execInMail([
				"doveadm",
				"-f",
				"tab",
				"mailbox",
				"status",
				"-u",
				mailbox.address,
				"messages unseen vsize guid",
				"*",
			]).catch(() => null),
			DockerService.execInMail([
				"doveadm",
				"-f",
				"tab",
				"quota",
				"get",
				"-u",
				mailbox.address,
			]).catch(() => null),
		]);
		if (!status || status.exitCode !== 0) {
			return null;
		}
		return {
			folders: parseMailboxStatus(status.stdout),
			quota:
				quota?.exitCode === 0
					? parseQuota(quota.stdout)
					: { limitBytes: null, messageLimit: null, messages: 0, usedBytes: 0 },
		};
	}

	/**
	 * Deletes every message in one of the mailbox's folders, addressed by its
	 * GUID so a name with `*` or `%` can't match other folders, then has
	 * Dovecot recount the quota.
	 *
	 * @throws When the folder isn't one of the mailbox's, or Dovecot refuses.
	 */
	async emptyFolder(mailbox: MailMailboxDTO, folder: string): Promise<void> {
		const contents = await this.contents(mailbox);
		const target = contents?.folders.find(
			(candidate) => candidate.name === folder,
		);
		if (!target?.guid) {
			throw new Error(`${mailbox.address} has no folder called ${folder}.`);
		}
		const result = await DockerService.execInMail([
			"doveadm",
			"expunge",
			"-u",
			mailbox.address,
			"mailbox-guid",
			target.guid,
			"all",
		]);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.trim() || "Dovecot refused to empty it.");
		}
		await DockerService.execInMail([
			"doveadm",
			"quota",
			"recalc",
			"-u",
			mailbox.address,
		]).catch(() => null);
	}

	/**
	 * Hands Postfix a short test message from the mailbox to `recipient`, the
	 * way a mail app's would go out: signed, queued and delivered.
	 *
	 * @throws When the server isn't running or Postfix refuses the message.
	 */
	async sendTest(mailbox: MailMailboxDTO, recipient: string): Promise<void> {
		const subject = `Test message from ${mailbox.address}`.replace(
			SUBJECT_RE,
			" ",
		);
		const body = [
			`From: ${mailbox.address}`,
			`To: ${recipient}`,
			`Subject: ${subject}`,
			`Date: ${new Date().toUTCString()}`,
			"",
			"Sent by Homerun's mail server self-test. If this reached you, outgoing mail works.",
			"",
		].join("\r\n");
		const result = await DockerService.execInMail([
			"bash",
			"-c",
			'printf "%s" "$1" | sendmail -f "$2" -- "$3"',
			"sendmail",
			body,
			mailbox.address,
			recipient,
		]);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.trim() || "Postfix refused the message.");
		}
	}
}

export const MailInboxService = new MailInboxServiceClass();
