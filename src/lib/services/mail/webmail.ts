import { serviceDomain } from "#lib/config.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { TemplateDTO } from "#lib/dto/template-dto.js";
import { Logger } from "#lib/logger.js";
import { defaultHostname } from "#lib/service-domains.js";

import { DeploymentService } from "../deploy.service.ts";
import { MailService } from "../mail.service.ts";
import { createServiceFromTemplate } from "../template-links.ts";

const logger = new Logger("Mail");

export const WEBMAIL_TEMPLATE_ID = "builtin-roundcube";
export const WEBMAIL_IMAGE = "roundcube/roundcubemail";

export interface WebmailEntry {
	id: string;
	name: string;
	url: string;
}

/**
 * Deploys Roundcube as an ordinary Homerun service from the built-in
 * template, pointed at this mail server: IMAP on 993 and SMTP on 465 at the
 * mail hostname, which the mail container answers to on Homerun's network,
 * so the certificate matches without leaving the server.
 */
class WebmailServiceClass {
	/** The Roundcube services already deployed, with where they're served. */
	async list(): Promise<WebmailEntry[]> {
		const services = (await ServiceDTO.list()).filter(
			(svc) => svc.toJSON().image === WEBMAIL_IMAGE,
		);
		return services.map((svc) => ({
			id: svc.id,
			name: svc.name,
			url: `https://${svc.toJSON().domains[0] ?? defaultHostname(svc.slug, null, serviceDomain())}`,
		}));
	}

	/**
	 * Creates a Roundcube service set up for this mail server and queues its
	 * first deploy.
	 *
	 * @returns The new service's id.
	 * @throws When the mail server has no hostname, or the template is missing.
	 */
	async deploy(userId: string): Promise<string> {
		const hostname = await MailService.hostname();
		if (!hostname) {
			throw new Error("Set the mail server's hostname first.");
		}
		const template = await TemplateDTO.get(WEBMAIL_TEMPLATE_ID);
		if (!template) {
			throw new Error("The Roundcube template isn't installed.");
		}
		const created = await createServiceFromTemplate(template, {
			hostAccess: false,
			stackId: null,
			userId,
		});
		if ("refusal" in created) {
			throw new Error(created.refusal);
		}
		const { linkedServices, svc } = created;
		await svc.update({
			envVars: {
				...svc.envVars,
				ROUNDCUBEMAIL_DEFAULT_HOST: `ssl://${hostname}`,
				ROUNDCUBEMAIL_DEFAULT_PORT: "993",
				ROUNDCUBEMAIL_SMTP_PORT: "465",
				ROUNDCUBEMAIL_SMTP_SERVER: `ssl://${hostname}`,
			},
		});
		await DeploymentService.enqueueStackDeploy(svc, linkedServices, userId);
		logger.info(`Webmail deployed: service=${svc.id} user=${userId}`);
		return svc.id;
	}
}

export const WebmailService = new WebmailServiceClass();
