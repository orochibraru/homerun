import { createTransport, type Transporter } from "nodemailer";
import type SmtpTransport from "nodemailer/lib/smtp-transport";
import { config, isSmtpEnabled } from "$lib/config";
import { Logger } from "$lib/logger";

const logger = new Logger("Email");

interface EmailProps {
	to: string;
	subject: string;
	content: string;
}

export class Email {
	from: string;
	to: string;
	subject: string;
	content: string;
	transporter: Transporter<
		SmtpTransport.SentMessageInfo,
		SmtpTransport.Options
	>;

	constructor({ to, subject, content }: EmailProps) {
		logger.debug(`Preparing email to: ${to}, subject: ${subject}`);
		this.to = to;
		this.subject = subject;
		this.content = content;

		if (!(isSmtpEnabled() && config.smtp?.from)) {
			logger.error("SMTP configuration is not defined or not enabled");
			throw new Error("SMTP configuration is not defined or not enabled");
		}

		this.from = config.smtp.from;

		this.transporter = createTransport({
			host: config.smtp.host,
			port: config.smtp.port,
			secure: config.smtp.secure, // true for port 465, false for other ports
			auth: {
				user: config.smtp.user,
				pass: config.smtp.password,
			},
		});

		logger.debug("SMTP transporter created successfully");
	}

	public send() {
		logger.info(`Sending email to: ${this.to}, subject: ${this.subject}`);
		return this.transporter.sendMail({
			to: this.to,
			from: this.from,
			subject: this.subject,
			text: this.content,
		});
	}
}
