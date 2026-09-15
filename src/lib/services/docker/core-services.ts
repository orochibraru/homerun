import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import { swarmNetworkName } from "./swarm.ts";

const LEADING_SLASH_RE = /^\//;

const logger = new Logger("Traefik");

export interface TraefikInfo {
	id: string;
	image: string;
	name: string;
}

export interface TraefikUpdateResult {
	message: string;
	updated: boolean;
}

/**
 * Rewrites a Traefik command line so every `--key=value` in `flags` is
 * present exactly once, replacing whatever that key was set to before and
 * appending it when it was absent. A null value removes the flag.
 */
export function applyFlags(
	cmd: string[],
	flags: Record<string, string | null>,
): string[] {
	const keys = Object.keys(flags);
	const kept = cmd.filter(
		(arg) =>
			!keys.some((key) => arg === `--${key}` || arg.startsWith(`--${key}=`)),
	);
	const added = keys
		.filter((key) => flags[key] !== null)
		.map((key) => `--${key}=${flags[key]}`);
	return [...kept, ...added];
}

/** What this mixin needs from the swarm mixin, which is merged ahead of it (see docker.service.ts). */
interface RequiresSwarmMixin {
	ensureSwarmNetwork: (name: string) => Promise<void>;
	initSwarm: () => Promise<boolean>;
}

/** Traefik container management : Homerun's own infra container, a deliberate narrow exception to the managed-label-only rule (see labels.ts). */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerCoreServicesMixin<
	TBase extends Constructor<BaseDockerService & RequiresSwarmMixin>,
>(Base: TBase) {
	return class DockerCoreServicesService extends Base {
		/**
		 * Locates the Traefik container this app's `compose.yaml` bootstraps.
		 *
		 * This is a DELIBERATE, narrow exception to the "only touch
		 * containers this app created" rule (see labels.ts) : Traefik is
		 * core infrastructure this app depends on but doesn't manage the
		 * lifecycle of by default. Matched by image name, since compose
		 * project naming isn't guaranteed stable across setups (no-compose /
		 * standalone Traefik is a documented fallback too).
		 */
		async findTraefikContainer(): Promise<TraefikInfo | null> {
			const containers = await this.getDocker().listContainers({
				all: true,
			});
			const match = containers.find((c) => c.Image.startsWith("traefik"));
			if (!match) {
				return null;
			}
			return {
				id: match.Id,
				image: match.Image,
				name:
					match.Names[0]?.replace(LEADING_SLASH_RE, "") ??
					match.Id.slice(0, 12),
			};
		}

		/**
		 * Restarts the Traefik container in place : same image, same config,
		 * just a process restart. Low-risk; use this for "Traefik seems
		 * stuck" without reaching for a full update.
		 */
		async restartTraefikContainer(): Promise<void> {
			const traefik = await this.findTraefikContainer();
			if (!traefik) {
				throw new Error("Traefik container not found.");
			}
			await this.getDocker().getContainer(traefik.id).restart();
			logger.info(`Traefik container restarted: ${traefik.id}`);
		}

		/**
		 * Recreates the Traefik container with `flags` merged into its own
		 * command line, everything else (image, mounts, networks, env, ports)
		 * read back off the running container unchanged.
		 *
		 * The narrow "Traefik is core infrastructure this app doesn't own"
		 * exception findTraefikContainer documents, extended one step
		 * further: this *does* change the live container's command, which
		 * updateTraefikContainer deliberately doesn't. It has to. Traefik
		 * reads its ACME account email, its providers and its entrypoints
		 * from static configuration at process start, so a dashboard field
		 * that only writes a database row is a field that does nothing, which
		 * is exactly what "Setting a Let's Encrypt email in the UI does
		 * nothing" meant. Returns `updated: false` without touching anything
		 * when every flag already holds the requested value.
		 */
		async applyTraefikFlags(
			flags: Record<string, string | null>,
		): Promise<TraefikUpdateResult> {
			const docker = this.getDocker();
			const traefik = await this.findTraefikContainer();
			if (!traefik) {
				throw new Error("Traefik container not found.");
			}

			const container = docker.getContainer(traefik.id);
			const info = await container.inspect();
			const cmd = info.Config.Cmd ?? [];
			const next = applyFlags(cmd, flags);
			if (
				next.length === cmd.length &&
				next.every((arg, i) => arg === cmd[i])
			) {
				return {
					message: "Traefik already runs with that configuration.",
					updated: false,
				};
			}

			const wasRunning = info.State.Running;
			const endpointsConfig = Object.fromEntries(
				Object.entries(info.NetworkSettings.Networks ?? {}).map(
					([netName, ep]) => [
						netName,
						{ Aliases: ep.Aliases, IPAMConfig: ep.IPAMConfig },
					],
				),
			);

			await container.stop().catch(() => {
				// Already stopped : remove() below still applies.
			});
			await container.remove();
			const recreated = await docker.createContainer({
				...info.Config,
				Cmd: next,
				HostConfig: info.HostConfig,
				NetworkingConfig: { EndpointsConfig: endpointsConfig },
				name: traefik.name,
			});
			if (wasRunning) {
				await recreated.start();
			}

			logger.info(`Traefik recreated with updated flags: ${next.join(" ")}`);
			return {
				message: "Traefik was recreated with the new configuration.",
				updated: true,
			};
		}

		/** Attaches Traefik to one more network, ignoring "already attached". */
		async #connectTraefik(network: string): Promise<void> {
			const traefik = await this.findTraefikContainer();
			if (!traefik) {
				return;
			}
			try {
				await this.getDocker()
					.getNetwork(network)
					.connect({ Container: traefik.id });
				logger.info(`Traefik attached to ${network}`);
			} catch (err) {
				const status = (err as { statusCode?: number }).statusCode;
				if (status !== 403 && status !== 409) {
					throw err;
				}
			}
		}

		/**
		 * Everything switching the dashboard's orchestration mode to Swarm
		 * actually requires on the host, in order: `docker swarm init` (this
		 * daemon has to be a manager before a single service can be created),
		 * an **attachable overlay** network for those services to share,
		 * Traefik attached to it, and Traefik's swarm provider turned on so it
		 * discovers them at all. Before this, flipping that select only wrote
		 * a database row and every swarm deploy failed on a daemon that
		 * wasn't in a swarm.
		 *
		 * Reports what it did as a list of lines rather than throwing on a
		 * missing Traefik : the mode is still worth saving on a host whose
		 * proxy lives elsewhere, the admin just has to wire that end up.
		 */
		async enableSwarmMode(): Promise<string[]> {
			const steps: string[] = [];
			steps.push(
				(await this.initSwarm())
					? "Initialised a new swarm on this host."
					: "This host is already a swarm manager.",
			);

			const network = swarmNetworkName();
			await this.ensureSwarmNetwork(network);
			steps.push(`Overlay network ${network} is ready.`);

			if (!(await this.findTraefikContainer())) {
				steps.push(
					`No Traefik container on this host : attach your proxy to ${network} and turn on its swarm provider by hand.`,
				);
				return steps;
			}

			await this.#connectTraefik(network);
			const applied = await this.applyTraefikFlags({
				"providers.swarm": "true",
				"providers.swarm.exposedByDefault": "false",
				"providers.swarm.network": network,
			});
			steps.push(applied.message);
			return steps;
		}

		/**
		 * Turns Traefik's swarm provider back off. Deliberately leaves the
		 * swarm itself running : `docker swarm leave --force` would kill every
		 * swarm service on the host, including ones this app didn't create,
		 * which is not a thing a dashboard select should do behind your back.
		 */
		async disableSwarmMode(): Promise<string[]> {
			if (!(await this.findTraefikContainer())) {
				return ["No Traefik container on this host : nothing to undo."];
			}
			const applied = await this.applyTraefikFlags({
				"providers.swarm": null,
				"providers.swarm.exposedByDefault": null,
				"providers.swarm.network": null,
			});
			return [
				applied.message,
				"The swarm itself is left running : run `docker swarm leave --force` yourself if you want it gone.",
			];
		}

		/**
		 * Puts the ACME account email Settings → Networking holds onto the
		 * running Traefik, which is the only place it means anything : Traefik
		 * reads it from static configuration at startup, so the field used to
		 * be recorded and never applied.
		 */
		async applyAcmeEmail(email: string | null): Promise<TraefikUpdateResult> {
			const key = `certificatesresolvers.${config.traefik.certResolver}.acme.email`;
			return await this.applyTraefikFlags({ [key]: email });
		}

		/**
		 * Pulls the latest image for whatever tag Traefik is *currently*
		 * running (read off the live container, e.g. "traefik:v3.1" : this
		 * never changes which tag is tracked) and, only if that pull
		 * actually produced a new image id, recreates the container from its
		 * own already-running Config/HostConfig/network attachments with
		 * just the image swapped in.
		 *
		 * This is the same narrow exception `findTraefikContainer` documents,
		 * extended to a mutating operation: it deliberately never invents new
		 * command-line flags or mounts (see custom-ssl.ts's "this app never
		 * modifies the live Traefik container's command/mounts itself"
		 * stance) : everything it recreates with is read back from
		 * `inspect()` on the container that's already running, byte-for-byte,
		 * only the image digest changes. There's a brief routing gap while
		 * the old container is removed and the new one starts, and no
		 * automatic rollback if the new container fails to start (nothing to
		 * roll back to : the old one is already gone).
		 */
		async updateTraefikContainer(): Promise<TraefikUpdateResult> {
			const docker = this.getDocker();
			const traefik = await this.findTraefikContainer();
			if (!traefik) {
				throw new Error("Traefik container not found.");
			}

			const container = docker.getContainer(traefik.id);
			const info = await container.inspect();
			const ref = info.Config.Image;

			logger.info(`Pulling latest image for Traefik: ${ref}`);
			const stream = await docker.pull(ref);
			await new Promise<void>((resolvePromise, reject) => {
				docker.modem.followProgress(stream, (err: Error | null) =>
					err ? reject(err) : resolvePromise(),
				);
			});

			const pulled = await docker.getImage(ref).inspect();
			if (pulled.Id === info.Image) {
				logger.info(`Traefik already up to date: ${ref}`);
				return {
					message: `Already running the latest ${ref}.`,
					updated: false,
				};
			}

			logger.info(`Recreating Traefik container with updated image: ${ref}`);
			const wasRunning = info.State.Running;

			// Only preserve the fields that matter for reattaching to the same
			// network(s) under the same alias(es) : not the read-only
			// inspect-only fields (NetworkID, EndpointID, Gateway, IPAddress,
			// ...) that come back alongside them, which the daemon assigns
			// fresh on create anyway.
			const endpointsConfig = Object.fromEntries(
				Object.entries(info.NetworkSettings.Networks ?? {}).map(
					([netName, ep]) => [
						netName,
						{ Aliases: ep.Aliases, IPAMConfig: ep.IPAMConfig },
					],
				),
			);

			await container.stop().catch(() => {
				// Already stopped : fine, remove() below still applies.
			});
			await container.remove();

			const recreated = await docker.createContainer({
				...info.Config,
				HostConfig: info.HostConfig,
				Image: ref,
				NetworkingConfig: { EndpointsConfig: endpointsConfig },
				name: traefik.name,
			});

			if (wasRunning) {
				await recreated.start();
			}

			logger.info(`Traefik updated and recreated: ${ref}`);
			return {
				message: `Updated to the latest ${ref} and restarted.`,
				updated: true,
			};
		}
	};
}
