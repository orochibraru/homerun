import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { Logger } = await import("../../../src/lib/logger");
const { EmailService } = await import(
	"../../../src/lib/services/email.service"
);

const originalSmtp = config.smtp;
const smtp = {
	enabled: true,
	from: "Homerun <noreply@example.com>",
	host: "smtp.example.com",
	password: "hunter2",
	port: 465,
	secure: true,
	user: "mailer",
};
const errors: unknown[] = [];

beforeEach(() => {
	config.smtp = { ...smtp };
	errors.length = 0;
	stub(Logger.prototype, "error", (err: unknown) => {
		errors.push(err);
	});
});

afterEach(() => {
	config.smtp = originalSmtp;
	restoreStubs();
});

const message = { content: "Hello", subject: "Hi", to: "ann@example.com" };

describe("EmailService", () => {
	test("builds an SMTP transport from the instance settings", () => {
		const email = new EmailService(message);

		expect(email.from).toBe(smtp.from);
		expect(email.to).toBe(message.to);
		expect(email.subject).toBe(message.subject);
		expect(email.content).toBe(message.content);
		const options = (
			email.transporter as unknown as {
				options: Record<string, unknown>;
			}
		).options;
		expect(options).toMatchObject({
			auth: { pass: "hunter2", user: "mailer" },
			host: "smtp.example.com",
			port: 465,
			secure: true,
		});
	});

	test("send passes the message to the transport as plain text", async () => {
		const email = new EmailService(message);
		const sent: unknown[] = [];
		stub(email.transporter, "sendMail", async (mail: unknown) => {
			sent.push(mail);
			return { messageId: "m1" };
		});

		expect(await email.send()).toEqual({ messageId: "m1" } as never);
		expect(sent).toEqual([
			{
				from: smtp.from,
				subject: "Hi",
				text: "Hello",
				to: "ann@example.com",
			},
		]);
	});

	test("refuses to build when SMTP is disabled", () => {
		config.smtp = { ...smtp, enabled: false };

		expect(() => new EmailService(message)).toThrow(
			"SMTP configuration is not defined or not enabled",
		);
		expect(errors).toHaveLength(1);
	});

	test("refuses to build when SMTP is enabled but incomplete", () => {
		config.smtp = { ...smtp, from: undefined };
		const warn = console.warn;
		console.warn = () => undefined;
		try {
			expect(() => new EmailService(message)).toThrow(/SMTP configuration/);
		} finally {
			console.warn = warn;
		}
	});
});
