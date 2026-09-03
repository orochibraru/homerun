import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";

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

/** Traefik container management : Homerun's own infra container, a deliberate narrow exception to the managed-label-only rule (see labels.ts). */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerCoreServicesMixin<
	TBase extends Constructor<BaseDockerService>,
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
