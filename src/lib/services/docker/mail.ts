import { config } from "#lib/config.js";
import { Logger } from "#lib/logger.js";
import { isNotFound, WorkerRequestError } from "#lib/server/worker-client.js";

import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams } from "./containers.ts";
import type { TraefikInfo } from "./core-services.ts";
import {
	acmeSourceFrom,
	type InspectedMount,
	MAIL_CONFIG_MOUNT,
	MAIL_CONFIG_VOLUME,
	MAIL_CONTAINER_NAME,
	MAIL_DATA_VOLUME,
	MAIL_IMAGE,
	MAIL_IMAGE_TAG,
	mailBinds,
	type MailConfigFile,
	mailConfigScript,
	type MailDesiredState,
	mailEnv,
	mailLabels,
	mailMatches,
	mailPortBindings,
} from "./mail-container.ts";
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";
import { swarmNetworkName } from "./swarm.ts";

const logger = new Logger("Mail");

export interface MailExecResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

interface RequiresMailDeps {
	ensureSharedNetwork: () => Promise<void>;
	findTraefikContainer: () => Promise<TraefikInfo | null>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
	runOneOff: (params: OneOffRunParams) => Promise<OneOffRunResult>;
}

interface MailInspect {
	Config?: { Env?: string[]; Labels?: Record<string, string> };
	HostConfig?: { Binds?: string[] | null };
	Id: string;
	NetworkSettings?: { Networks?: Record<string, unknown> };
	RestartCount?: number;
	State?: {
		Error?: string;
		ExitCode?: number;
		FinishedAt?: string;
		Restarting?: boolean;
		Running?: boolean;
		StartedAt?: string;
		Status?: string;
	};
}

export interface MailHealth {
	error: string | null;
	exists: boolean;
	exitCode: number | null;
	restartCount: number;
	restarting: boolean;
	running: boolean;
	startedAt: string | null;
}

interface TraefikInspect {
	Config?: { Cmd?: string[] };
	Mounts?: InspectedMount[];
}

/**
 * Runs the mail server, a single docker-mailserver container, as a core
 * container: its own volumes for mail, state, logs and config, the SMTP and
 * IMAP ports published on the host, and Traefik's certificate store mounted
 * read-only for TLS. Homerun's database is the source of truth: the config
 * files are rewritten from it and docker-mailserver picks them up on its own.
 * Requires the one-off and core-services mixins ahead of it.
 */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerMailMixin<
	TBase extends Constructor<BaseDockerService & RequiresMailDeps>,
>(Base: TBase) {
	return class DockerMailService extends Base {
		/** The mail container's inspect body, or null when it doesn't exist. */
		async #inspectMail(): Promise<MailInspect | null> {
			return await this.worker
				.get<MailInspect>(`/v1/containers/${MAIL_CONTAINER_NAME}/inspect`)
				.catch((err: unknown) => {
					if (isNotFound(err)) {
						return null;
					}
					throw err;
				});
		}

		/** The mail container's state: running, crash-looping or stopped, with its restart count and last exit. */
		async mailHealth(): Promise<MailHealth> {
			const info = await this.#inspectMail();
			const state = info?.State;
			const running = state?.Running === true && state.Restarting !== true;
			return {
				error: state?.Error || null,
				exists: info !== null,
				exitCode: running ? null : (state?.ExitCode ?? null),
				restartCount: info?.RestartCount ?? 0,
				restarting: state?.Restarting === true,
				running,
				startedAt: state?.StartedAt ?? null,
			};
		}

		/**
		 * The mail container's last `tail` lines of output, Postfix, Dovecot
		 * and rspamd all logging there. Empty when the container doesn't exist.
		 */
		async mailLogs(tail: number): Promise<string> {
			const stream = await this.worker
				.stream(`v1/containers/${MAIL_CONTAINER_NAME}/logs`, {
					query: { follow: "0", tail: String(tail) },
				})
				.catch((err: unknown) => {
					if (isNotFound(err)) {
						return null;
					}
					throw err;
				});
			return stream ? await new Response(stream).text() : "";
		}

		/** Whether the mail container exists and is running. */
		async mailRunning(): Promise<boolean> {
			const info = await this.#inspectMail();
			return info?.State?.Running === true;
		}

		/**
		 * Where Traefik keeps its `acme.json`, as a volume name or host path
		 * the mail container can mount. Null when Traefik isn't found or its
		 * storage isn't an `acme.json` at the root of a mount.
		 */
		async mailCertSource(): Promise<string | null> {
			const traefik = await this.findTraefikContainer();
			if (!traefik) {
				return null;
			}
			const info = await this.worker.get<TraefikInspect>(
				`/v1/containers/${traefik.id}/inspect`,
			);
			return acmeSourceFrom(
				info.Config?.Cmd ?? [],
				info.Mounts ?? [],
				config.traefik.certResolver,
			);
		}

		/**
		 * Replaces docker-mailserver's managed config files in its config
		 * volume through a one-off container, whether or not the mail server
		 * runs. The DKIM key directory is cleared first, so a removed
		 * domain's key goes with it.
		 *
		 * @throws When the helper container fails.
		 */
		async writeMailConfig(files: MailConfigFile[]): Promise<void> {
			const result = await this.runOneOff({
				binds: [`${MAIL_CONFIG_VOLUME}:${MAIL_CONFIG_MOUNT}`],
				cmd: ["sh", "-c", mailConfigScript(files)],
				envVars: Object.fromEntries(
					files.map((file, index) => [`MAIL_FILE_${index}`, file.content]),
				),
				image: "alpine",
				tag: "3",
				timeoutMs: 60_000,
			});
			if (result.exitCode !== 0) {
				throw new Error(
					`Couldn't write the mail server's config: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`,
				);
			}
		}

		/**
		 * Wipes maildirs (`domain` or `domain/local` under the data volume)
		 * through a one-off container, so it works whether or not the mail
		 * server runs.
		 *
		 * @throws When the helper container fails.
		 */
		async purgeMailDirs(paths: string[]): Promise<void> {
			if (paths.length === 0) {
				return;
			}
			const result = await this.runOneOff({
				binds: [`${MAIL_DATA_VOLUME}:/data`],
				cmd: ["rm", "-rf", "--", ...paths.map((path) => `/data/${path}`)],
				image: "alpine",
				tag: "3",
				timeoutMs: 120_000,
			});
			if (result.exitCode !== 0) {
				throw new Error(
					`Couldn't wipe the deleted mailboxes: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`,
				);
			}
		}

		/** Pulls docker-mailserver's image when missing, then creates and starts its container. */
		async #createMail(state: MailDesiredState): Promise<void> {
			const image = `${MAIL_IMAGE}:${MAIL_IMAGE_TAG}`;
			const present = await this.worker.get<{ id: string | null }>(
				"/v1/images/id",
				{ ref: image },
			);
			if (!present.id) {
				await this.pullImage({ image: MAIL_IMAGE, tag: MAIL_IMAGE_TAG });
			}
			const ports = mailPortBindings();
			const created = await this.worker.post<{ id: string }>("/v1/containers", {
				body: {
					Env: mailEnv(state),
					ExposedPorts: Object.fromEntries(
						Object.keys(ports).map((port) => [port, {}]),
					),
					HostConfig: {
						Binds: mailBinds(state),
						NetworkMode: config.docker.networkName,
						PortBindings: ports,
						RestartPolicy: { Name: "unless-stopped" },
					},
					Hostname: state.hostname,
					Image: image,
					Labels: mailLabels(state),
					NetworkingConfig: {
						EndpointsConfig: {
							[config.docker.networkName]: { Aliases: [state.hostname] },
						},
					},
					StopTimeout: 60,
				},
				name: MAIL_CONTAINER_NAME,
			});
			await this.worker.post(`/v1/containers/${created.id}/start`);
			logger.info(`Mail server created: ${MAIL_CONTAINER_NAME}`);
		}

		/**
		 * Brings the mail container in line with `state`: creates it, or
		 * recreates it when its environment, binds or Traefik labels changed.
		 * Null stops and removes it. The volumes are never touched, so every
		 * mailbox survives both. A running server is then attached to the
		 * swarm overlay under its hostname.
		 *
		 * @returns A warning when the overlay refused the attach, else null.
		 */
		async reconcileMail(
			state: MailDesiredState | null,
		): Promise<string | null> {
			const info = await this.#inspectMail();
			if (!state) {
				if (info) {
					await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
					logger.info("Mail server removed, its volumes keep the mail.");
				}
				return null;
			}
			await this.ensureSharedNetwork();
			if (!info) {
				await this.#createMail(state);
			} else if (
				mailMatches(
					info.Config?.Env ?? [],
					info.Config?.Labels ?? {},
					info.HostConfig?.Binds ?? [],
					state,
				)
			) {
				if (!info.State?.Running) {
					await this.worker.post(`/v1/containers/${info.Id}/start`);
				}
			} else {
				await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
				await this.#createMail(state);
			}
			return await this.#attachMailToSwarm(state.hostname);
		}

		/**
		 * Attaches the mail container to the swarm overlay under its hostname,
		 * so a swarm service such as Roundcube reaches it there with a
		 * matching certificate, as services on the shared network do. A no-op
		 * when it's already attached or swarm mode never created the overlay.
		 *
		 * @returns Why the attach was refused (an overlay that isn't
		 *   attachable), or null when it's attached or there's nothing to do.
		 */
		async #attachMailToSwarm(hostname: string): Promise<string | null> {
			const info = await this.#inspectMail();
			const network = swarmNetworkName();
			if (!info || info.NetworkSettings?.Networks?.[network]) {
				return null;
			}
			try {
				await this.worker.post(`/v1/containers/${info.Id}/connect`, {
					aliases: [hostname],
					network,
				});
				logger.info(`Mail server attached to ${network} as ${hostname}`);
				return null;
			} catch (err) {
				const status = err instanceof WorkerRequestError ? err.status : 0;
				if (status === 404 || status === 409) {
					return null;
				}
				if (status === 403) {
					const warning = `Docker refused to attach the mail server to ${network} (${err instanceof Error ? err.message : "403"}): swarm services can't reach it at ${hostname}. Recreate ${network} as an attachable overlay.`;
					logger.warn(warning);
					return warning;
				}
				throw err;
			}
		}

		/**
		 * Runs `cmd` inside the running mail container.
		 *
		 * @throws When the container isn't running or the worker refuses.
		 */
		async execInMail(cmd: string[]): Promise<MailExecResult> {
			return await this.worker.post<MailExecResult>("/v1/exec", {
				cmd,
				container: MAIL_CONTAINER_NAME,
			});
		}
	};
}
