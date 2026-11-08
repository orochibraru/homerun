import { Resolver } from "node:dns/promises";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import {
	isSmtpGreeting,
	type MailCheck,
	queuedMessages,
} from "#lib/mail-doveadm.js";
import {
	deliveryFailures,
	parseMailLog,
	summarizeMailLog,
} from "#lib/mail-log.js";

import { DockerService } from "../docker.service.ts";
import { MailService } from "../mail.service.ts";

const PROBE_TIMEOUT_MS = 8000;
const DAY_MS = 86_400_000;
const EXPIRY_WARN_DAYS = 14;
const OUTBOUND_PROBE_HOST = "gmail-smtp-in.l.google.com";
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const RECENT_LOG_TAIL = 2000;

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Resolves with the first line `socket` sends, or rejects on error or after the probe timeout; the socket is closed either way. */
function firstLine(socket: Socket | TLSSocket): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000}s`));
		}, PROBE_TIMEOUT_MS);
		socket.once("data", (chunk: Buffer) => {
			clearTimeout(timer);
			socket.destroy();
			resolvePromise(chunk.toString().split("\r\n")[0] ?? "");
		});
		socket.once("error", (err) => {
			clearTimeout(timer);
			socket.destroy();
			reject(err);
		});
	});
}

/**
 * Runs the mail server's self-test: whether its container runs, whether the
 * internet reaches each port with a valid certificate, whether it can send
 * on port 25, its reverse DNS, the queue, and every domain's records.
 * Nothing it does changes anything.
 */
class MailSelfTestServiceClass {
	/** Every check, in the order the Server tab shows them. */
	async run(): Promise<MailCheck[]> {
		const hostname = await MailService.hostname();
		const running = await DockerService.mailRunning().catch(() => false);
		const checks: MailCheck[] = [
			{
				detail: running
					? "The container runs."
					: "The container isn't running: turn the server on and add a mailbox.",
				id: "container",
				label: "Mail server container",
				state: running ? "ok" : "fail",
			},
		];
		if (!hostname) {
			return [
				...checks,
				{
					detail: "Set the mail hostname on this tab first.",
					id: "hostname",
					label: "Hostname",
					state: "fail",
				},
			];
		}
		const probes = await Promise.all([
			this.#certificate(hostname),
			this.#smtp(hostname, 25, "Incoming mail (port 25)", false),
			this.#smtp(hostname, 465, "Submission over TLS (port 465)", true),
			this.#smtp(hostname, 587, "Submission with STARTTLS (port 587)", false),
			this.#reverseDns(hostname),
			...(running
				? [this.#outbound(), this.#queue(), this.#recentDeliveries()]
				: []),
			this.#domains(),
		]);
		return [...checks, ...probes];
	}

	/** The certificate IMAP serves on 993: valid for the hostname, and how long until it expires. */
	async #certificate(hostname: string): Promise<MailCheck> {
		const base = {
			id: "certificate",
			label: "TLS certificate (IMAP, port 993)",
		};
		try {
			const socket = connectTls({
				host: hostname,
				port: 993,
				servername: hostname,
			});
			const ready = new Promise<TLSSocket>((resolvePromise, reject) => {
				socket.once("secureConnect", () => resolvePromise(socket));
				socket.once("error", reject);
				setTimeout(
					() => reject(new Error("no TLS handshake within 8s")),
					PROBE_TIMEOUT_MS,
				);
			});
			const peer = (await ready).getPeerCertificate();
			socket.destroy();
			const days = Math.floor(
				(new Date(peer.valid_to).getTime() - Date.now()) / DAY_MS,
			);
			const issuer = peer.issuer?.O ?? peer.issuer?.CN ?? "unknown issuer";
			return {
				...base,
				detail: `Valid for ${hostname}, issued by ${issuer}, expires in ${days} days.`,
				state: days < EXPIRY_WARN_DAYS ? "warn" : "ok",
			};
		} catch (err) {
			return {
				...base,
				detail: `Couldn't get a valid certificate for ${hostname}: ${message(err)}.`,
				state: "fail",
			};
		}
	}

	/** Whether `port` on the hostname answers with an SMTP greeting, as a client out there would reach it. */
	async #smtp(
		hostname: string,
		port: number,
		label: string,
		tls: boolean,
	): Promise<MailCheck> {
		const id = `smtp-${port}`;
		try {
			const socket = tls
				? connectTls({ host: hostname, port, servername: hostname })
				: connectTcp({ host: hostname, port });
			const line = await firstLine(socket);
			return isSmtpGreeting(line)
				? { detail: line, id, label, state: "ok" }
				: { detail: `Unexpected greeting: ${line}`, id, label, state: "warn" };
		} catch (err) {
			return {
				detail: `${hostname}:${port} didn't answer: ${message(err)}. Check the firewall, or your router's port forwarding.`,
				id,
				label,
				state: "fail",
			};
		}
	}

	/** Whether the server's address has a PTR record naming the hostname, which most receivers want. */
	async #reverseDns(hostname: string): Promise<MailCheck> {
		const base = { id: "ptr", label: "Reverse DNS (PTR)" };
		const resolver = new Resolver({ timeout: 3000, tries: 2 });
		resolver.setServers(PUBLIC_RESOLVERS);
		const [address] = await resolver.resolve4(hostname).catch(() => []);
		if (!address) {
			return {
				...base,
				detail: `${hostname} has no A record yet.`,
				state: "fail",
			};
		}
		const names = await resolver.reverse(address).catch(() => []);
		if (names.some((name) => name.toLowerCase() === hostname)) {
			return { ...base, detail: `${address} → ${hostname}`, state: "ok" };
		}
		return {
			...base,
			detail: names.length
				? `${address} points at ${names.join(", ")}, not ${hostname}. Ask your hosting provider to change it.`
				: `${address} has no PTR record. Ask your hosting provider for one naming ${hostname}.`,
			state: "warn",
		};
	}

	/** Whether the server can open a connection to another mail server on port 25, which many providers block. */
	async #outbound(): Promise<MailCheck> {
		const base = { id: "outbound", label: "Sending out (port 25)" };
		const result = await DockerService.execInMail([
			"bash",
			"-c",
			`timeout 8 bash -c '</dev/tcp/${OUTBOUND_PROBE_HOST}/25'`,
		]).catch(() => null);
		return result?.exitCode === 0
			? {
					...base,
					detail: `Reached ${OUTBOUND_PROBE_HOST} on port 25.`,
					state: "ok",
				}
			: {
					...base,
					detail:
						"Couldn't reach another mail server on port 25: your provider most likely blocks it, ask them to lift it.",
					state: "fail",
				};
	}

	/** How many messages sit in Postfix's queue: a growing queue means mail isn't leaving. */
	async #queue(): Promise<MailCheck> {
		const base = { id: "queue", label: "Outgoing queue" };
		const result = await DockerService.execInMail(["mailq"]).catch(() => null);
		if (!result) {
			return { ...base, detail: "Couldn't read the queue.", state: "warn" };
		}
		const count = queuedMessages(result.stdout);
		return count === 0
			? { ...base, detail: "Empty.", state: "ok" }
			: {
					...base,
					detail: `${count} messages waiting to be delivered.`,
					state: "warn",
				};
	}

	/** Whether the recent log shows bounced or deferred messages, and to whom. */
	async #recentDeliveries(): Promise<MailCheck> {
		const base = { id: "deliveries", label: "Recent deliveries" };
		const lines = parseMailLog(await DockerService.mailLogs(RECENT_LOG_TAIL));
		const summary = summarizeMailLog(lines);
		if (summary.bounced === 0 && summary.deferred === 0) {
			return {
				...base,
				detail: "No bounce or delay in the recent log.",
				state: "ok",
			};
		}
		const last = deliveryFailures(lines).at(-1);
		return {
			...base,
			detail: `${summary.bounced} bounced, ${summary.deferred} deferred lately.${last ? ` Last: ${last.recipient}, ${last.reason}` : ""} See the Logs tab.`,
			state: summary.bounced > 0 ? "fail" : "warn",
		};
	}

	/** One line summing up every domain's DNS records. */
	async #domains(): Promise<MailCheck> {
		const base = { id: "dns", label: "Domain records" };
		const domains = await MailDomainDTO.list();
		if (domains.length === 0) {
			return { ...base, detail: "No mail domain yet.", state: "warn" };
		}
		const results = await Promise.all(
			domains.map(async (domain) => {
				const checks = await MailService.checkRecords(domain);
				const missing = checks
					.filter((check) => check.state !== "ok")
					.map((check) => check.record.type);
				return { missing, name: domain.name };
			}),
		);
		const broken = results.filter((result) => result.missing.length > 0);
		return broken.length === 0
			? {
					...base,
					detail: `MX, SPF, DKIM and DMARC are in place for ${domains.length} domains.`,
					state: "ok",
				}
			: {
					...base,
					detail: broken
						.map((result) => `${result.name}: ${result.missing.join(", ")}`)
						.join(" · "),
					state: "fail",
				};
	}
}

export const MailSelfTestService = new MailSelfTestServiceClass();
