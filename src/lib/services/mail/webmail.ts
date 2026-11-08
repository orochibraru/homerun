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
	 * Points every Roundcube service still using `previous` as its IMAP or
	 * SMTP host at `next` instead, and redeploys it. A host someone set by
	 * hand to anything else is left alone. A service whose redeploy can't be
	 * queued gets its old hosts back, so calling this again retries it.
	 *
	 * @returns How many services were updated.
	 * @throws When a redeploy can't be queued, after restoring that service.
	 */
	async retarget(
		previous: string | null,
		next: string | null,
		userId: string,
	): Promise<number> {
		if (!(previous && next) || previous === next) {
			return 0;
		}
		const keys = ["ROUNDCUBEMAIL_DEFAULT_HOST", "ROUNDCUBEMAIL_SMTP_SERVER"];
		const old = `ssl://${previous}`;
		let updated = 0;
		for (const svc of await ServiceDTO.list()) {
			const env = svc.envVars;
			if (
				svc.toJSON().image !== WEBMAIL_IMAGE ||
				!keys.some((key) => env[key] === old)
			) {
				continue;
			}
			const patch = Object.fromEntries(
				keys
					.filter((key) => env[key] === old)
					.map((key) => [key, `ssl://${next}`]),
			);
			// oxlint-disable-next-line no-await-in-loop -- one service at a time, each queues its own deploy
			await this.#retargetOne(svc, { ...env, ...patch }, userId);
			updated += 1;
		}
		if (updated > 0) {
			logger.info(
				`Webmail retargeted from ${previous} to ${next}: ${updated} services`,
			);
		}
		return updated;
	}

	/**
	 * Saves `envVars` on one Roundcube service and queues its redeploy,
	 * putting its previous environment back when the queueing fails.
	 *
	 * @throws When the redeploy can't be queued.
	 */
	async #retargetOne(
		svc: ServiceDTO,
		envVars: Record<string, string>,
		userId: string,
	): Promise<void> {
		const previous = { ...svc.envVars };
		await svc.update({ envVars });
		try {
			await DeploymentService.enqueueStackDeploy(svc, [], userId);
		} catch (err) {
			await svc.update({ envVars: previous });
			throw err;
		}
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
