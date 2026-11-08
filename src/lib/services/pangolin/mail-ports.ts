import { Logger } from "#lib/logger.js";
import { MAIL_PORTS } from "#lib/mail.js";

import { MAIL_CONTAINER_NAME } from "../docker/mail-container.ts";
import { PangolinService } from "../pangolin.service.ts";
import {
	PangolinApiError,
	type PangolinEnvelope,
	pangolinRequest,
} from "./http.ts";

const logger = new Logger("Pangolin");

interface RawResource {
	http?: boolean;
	mode?: string | null;
	name: string;
	protocol?: string | null;
	proxyPort?: number | null;
	resourceId: number | string;
}

type Connection = NonNullable<
	Awaited<ReturnType<typeof PangolinService.settingsOrNull>>
>;

export interface MailPortResult {
	detail: string;
	ok: boolean;
	port: number;
}

/** The name Homerun gives the raw resource publishing mail port `port`. */
export function mailResourceName(port: number): string {
	return `Homerun mail ${port}`;
}

/** Whether `resource` is a raw TCP resource listening on `port`. */
export function isRawTcpOn(resource: RawResource, port: number): boolean {
	const raw =
		resource.mode === "tcp" ||
		(resource.http === false && resource.protocol === "tcp");
	return raw && Number(resource.proxyPort) === port;
}

/**
 * The address a raw resource's target reaches the mail server at: the mail
 * container on Homerun's network when the tunnel sits on it (Pangolin's own
 * resources target Traefik's container then), else the host the tunnel
 * reaches, where the ports are published too.
 */
export function mailTargetHost(tunnelHost: string, explicit: boolean): string {
	return explicit || tunnelHost === "localhost"
		? tunnelHost
		: MAIL_CONTAINER_NAME;
}

function refusal(port: number, err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	return `Pangolin refused a raw TCP resource on ${port} (${message}). On the Pangolin server, set flags.allow_raw_resources: true in config.yml, add a tcp-${port} entrypoint on :${port}/tcp to its Traefik, and publish ${port} on the gerbil container.`;
}

/**
 * Publishes the mail server's ports through Pangolin as raw TCP resources:
 * mail servers and mail apps connect to the mail hostname, whose address
 * record points at Pangolin when Pangolin routes this instance, so 25, 465,
 * 587 and 993 have to be forwarded from there through the site's tunnel.
 */
class PangolinMailPortsClass {
	/**
	 * Creates or repairs one raw TCP resource and target per mail port.
	 *
	 * @returns One verdict per port, or null when Pangolin isn't this
	 *   instance's provider.
	 */
	async sync(): Promise<MailPortResult[] | null> {
		const connection = await PangolinService.settingsOrNull();
		if (!connection) {
			return null;
		}
		const { baseUrl, mainSiteName, orgId, token } = connection;
		const sites = await PangolinService.listSites(baseUrl, token, orgId);
		const site = sites.find((candidate) => candidate.name === mainSiteName);
		if (!site) {
			return MAIL_PORTS.map(({ port }) => ({
				detail: `site "${mainSiteName}" not found`,
				ok: false,
				port,
			}));
		}
		const resources = (await PangolinService.listResources(
			baseUrl,
			token,
			orgId,
		)) as RawResource[];
		const results: MailPortResult[] = [];
		for (const { port } of MAIL_PORTS) {
			// oxlint-disable-next-line no-await-in-loop -- Pangolin rejects concurrent creates on one org
			const result = await this.#syncPort(
				connection,
				resources,
				site.siteId,
				port,
			);
			results.push(result);
		}
		return results;
	}

	/** Creates or repairs the raw resource and its target for one port. */
	async #syncPort(
		connection: Connection,
		resources: RawResource[],
		siteId: number | string,
		port: number,
	): Promise<MailPortResult> {
		const { baseUrl, orgId, token } = connection;
		let resource = resources.find((candidate) => isRawTcpOn(candidate, port));
		let created = false;
		if (!resource) {
			try {
				const response = await pangolinRequest<PangolinEnvelope<RawResource>>(
					baseUrl,
					token,
					`/org/${orgId}/resource`,
					{
						body: JSON.stringify({
							mode: "tcp",
							name: mailResourceName(port),
							proxyPort: port,
						}),
						method: "PUT",
					},
				);
				resource = response.data ?? undefined;
				created = true;
			} catch (err) {
				return { detail: refusal(port, err), ok: false, port };
			}
		}
		if (!resource?.resourceId) {
			return { detail: "Pangolin created no resource id", ok: false, port };
		}
		try {
			const target = await this.#ensureTarget(
				connection,
				resource.resourceId,
				siteId,
				port,
			);
			if (created) {
				logger.info(`Pangolin raw resource created for mail port ${port}`);
			}
			return {
				detail: `${created ? "created" : "kept"} tcp:${port} -> ${target}`,
				ok: true,
				port,
			};
		} catch (err) {
			return {
				detail: err instanceof Error ? err.message : String(err),
				ok: false,
				port,
			};
		}
	}

	/**
	 * Points the resource's target at the mail server: an enabled one at the
	 * right address is kept, another one is moved, and none gets one added.
	 *
	 * @returns The target's address.
	 * @throws When Pangolin refuses the change.
	 */
	async #ensureTarget(
		connection: Connection,
		resourceId: number | string,
		siteId: number | string,
		port: number,
	): Promise<string> {
		const { baseUrl, token } = connection;
		const host = mailTargetHost(
			connection.targetHost,
			connection.targetHostExplicit,
		);
		const wanted = `${host}:${port}`;
		const targets = await PangolinService.listTargets(
			baseUrl,
			token,
			resourceId,
		);
		const same = targets.find(
			(target) =>
				target.ip === host &&
				target.port === port &&
				target.enabled !== false &&
				(target.siteId === undefined ||
					String(target.siteId) === String(siteId)),
		);
		if (same) {
			return wanted;
		}
		const body = JSON.stringify({ enabled: true, ip: host, port, siteId });
		const stale = targets[0];
		await (stale
			? pangolinRequest(baseUrl, token, `/target/${stale.targetId}`, {
					body,
					method: "POST",
				})
			: pangolinRequest(baseUrl, token, `/resource/${resourceId}/target`, {
					body,
					method: "PUT",
				}));
		return wanted;
	}

	/**
	 * The mail ports Pangolin has no raw TCP resource for.
	 *
	 * @returns The missing ports, or null when Pangolin isn't this
	 *   instance's provider.
	 * @throws PangolinApiError when Pangolin refuses the listing.
	 */
	async missing(): Promise<number[] | null> {
		const connection = await PangolinService.settingsOrNull();
		if (!connection) {
			return null;
		}
		const resources = (await PangolinService.listResources(
			connection.baseUrl,
			connection.token,
			connection.orgId,
		)) as RawResource[];
		return MAIL_PORTS.map(({ port }) => port).filter(
			(port) => !resources.some((resource) => isRawTcpOn(resource, port)),
		);
	}

	/**
	 * Deletes the raw resources Homerun created for the mail ports, found by
	 * port and name so one the admin made by hand stays. Failures are logged.
	 */
	async remove(): Promise<void> {
		const connection = await PangolinService.settingsOrNull();
		if (!connection) {
			return;
		}
		const { baseUrl, orgId, token } = connection;
		const resources = (await PangolinService.listResources(
			baseUrl,
			token,
			orgId,
		).catch(() => [])) as RawResource[];
		const ours = resources.filter((resource) =>
			MAIL_PORTS.some(
				({ port }) =>
					isRawTcpOn(resource, port) &&
					resource.name === mailResourceName(port),
			),
		);
		await Promise.all(
			ours.map((resource) =>
				pangolinRequest(baseUrl, token, `/resource/${resource.resourceId}`, {
					method: "DELETE",
				}).catch((err: unknown) => {
					if (!(err instanceof PangolinApiError && err.status === 404)) {
						logger.warn(
							`Couldn't remove Pangolin resource ${resource.name}: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}),
			),
		);
	}
}

export const PangolinMailPorts = new PangolinMailPortsClass();
