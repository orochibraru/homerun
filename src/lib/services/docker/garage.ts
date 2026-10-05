import { config } from "#lib/config.js";
import { Logger } from "#lib/logger.js";
import { isNotFound } from "#lib/server/worker-client.js";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams } from "./containers.ts";
import type { SelfContainer } from "./core-services.ts";
import {
	GARAGE_ADMIN_HOST_PORT,
	GARAGE_ADMIN_PORT,
	GARAGE_CONFIG_DIR,
	GARAGE_CONFIG_FILE,
	GARAGE_CONFIG_VOLUME,
	GARAGE_CONTAINER_NAME,
	GARAGE_DATA_DIR,
	GARAGE_DATA_VOLUME,
	GARAGE_IMAGE,
	GARAGE_IMAGE_TAG,
	GARAGE_META_DIR,
	GARAGE_META_VOLUME,
	GARAGE_S3_HOST_PORT,
	GARAGE_S3_PORT,
	type GarageDesiredState,
	garageEnv,
	garageLabels,
	garageMatches,
	garageToml,
} from "./garage-container.ts";
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";

const logger = new Logger("Garage");

export interface GarageEndpoints {
	admin: string;
	s3: string;
}

interface RequiresGarageDeps {
	ensureSharedNetwork: () => Promise<void>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
	runOneOff: (params: OneOffRunParams) => Promise<OneOffRunResult>;
	selfContainer: () => Promise<SelfContainer | null>;
}

interface GarageInspect {
	Config?: { Env?: string[]; Labels?: Record<string, string> };
	Id: string;
	State?: { Running?: boolean };
}

/**
 * Runs the built-in object store, a single Garage node, as a core container
 * next to the registry: its own volumes for metadata, data and config, on the
 * shared network, published on loopback ports only, and optionally routed by
 * Traefik at a public hostname. Requires the one-off mixin ahead of it.
 */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerGarageMixin<
	TBase extends Constructor<BaseDockerService & RequiresGarageDeps>,
>(Base: TBase) {
	return class DockerGarageService extends Base {
		/** The Garage container's inspect body, or null when it doesn't exist. */
		async #inspectGarage(): Promise<GarageInspect | null> {
			return await this.worker
				.get<GarageInspect>(`/v1/containers/${GARAGE_CONTAINER_NAME}/inspect`)
				.catch((err: unknown) => {
					if (isNotFound(err)) {
						return null;
					}
					throw err;
				});
		}

		/** Whether the Garage container exists and is running. */
		async garageRunning(): Promise<boolean> {
			const info = await this.#inspectGarage();
			return info?.State?.Running === true;
		}

		/**
		 * Writes Garage's config file into its config volume through a one-off
		 * container, since the Garage image has no shell to do it and the app
		 * can't write into another container's volume.
		 */
		async #writeGarageConfig(): Promise<void> {
			await this.runOneOff({
				binds: [`${GARAGE_CONFIG_VOLUME}:${GARAGE_CONFIG_DIR}`],
				cmd: ["sh", "-c", `printf '%s' "$GARAGE_TOML" > ${GARAGE_CONFIG_FILE}`],
				envVars: { GARAGE_TOML: garageToml() },
				image: "alpine",
				tag: "3",
			});
		}

		/** Pulls Garage's image when missing, then creates and starts its container. */
		async #createGarage(state: GarageDesiredState): Promise<void> {
			const image = `${GARAGE_IMAGE}:${GARAGE_IMAGE_TAG}`;
			const present = await this.worker.get<{ id: string | null }>(
				"/v1/images/id",
				{ ref: image },
			);
			if (!present.id) {
				await this.pullImage({ image: GARAGE_IMAGE, tag: GARAGE_IMAGE_TAG });
			}
			await this.#writeGarageConfig();
			const created = await this.worker.post<{ id: string }>("/v1/containers", {
				body: {
					Cmd: ["/garage", "-c", GARAGE_CONFIG_FILE, "server"],
					Env: garageEnv(state),
					ExposedPorts: {
						[`${GARAGE_ADMIN_PORT}/tcp`]: {},
						[`${GARAGE_S3_PORT}/tcp`]: {},
					},
					HostConfig: {
						Binds: [
							`${GARAGE_META_VOLUME}:${GARAGE_META_DIR}`,
							`${GARAGE_DATA_VOLUME}:${GARAGE_DATA_DIR}`,
							`${GARAGE_CONFIG_VOLUME}:${GARAGE_CONFIG_DIR}:ro`,
						],
						NetworkMode: config.docker.networkName,
						PortBindings: {
							[`${GARAGE_ADMIN_PORT}/tcp`]: [
								{
									HostIp: "127.0.0.1",
									HostPort: String(GARAGE_ADMIN_HOST_PORT),
								},
							],
							[`${GARAGE_S3_PORT}/tcp`]: [
								{ HostIp: "127.0.0.1", HostPort: String(GARAGE_S3_HOST_PORT) },
							],
						},
						RestartPolicy: { Name: "unless-stopped" },
					},
					Image: image,
					Labels: garageLabels(state),
				},
				name: GARAGE_CONTAINER_NAME,
			});
			await this.worker.post(`/v1/containers/${created.id}/start`);
			logger.info(`Garage created: ${GARAGE_CONTAINER_NAME}`);
		}

		/**
		 * Brings the Garage container in line with `state`, creating it, or
		 * recreating it when its secrets or Traefik labels changed. Null stops
		 * and removes the container. The volumes are never touched, so every
		 * bucket survives both.
		 */
		async reconcileGarage(state: GarageDesiredState | null): Promise<void> {
			const info = await this.#inspectGarage();
			if (!state) {
				if (info) {
					await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
					logger.info(`Garage removed, ${GARAGE_DATA_VOLUME} keeps its data.`);
				}
				return;
			}
			await this.ensureSharedNetwork();
			if (!info) {
				await this.#createGarage(state);
				return;
			}
			if (
				garageMatches(info.Config?.Env ?? [], info.Config?.Labels ?? {}, state)
			) {
				if (!info.State?.Running) {
					await this.worker.post(`/v1/containers/${info.Id}/start`);
				}
				return;
			}
			await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
			await this.#createGarage(state);
		}

		/**
		 * Garage's admin and S3 base URLs as this process reaches them: the
		 * loopback ports, or the container name on the shared network when the
		 * app itself runs in a container. The first address whose admin port
		 * answers at all wins.
		 *
		 * @throws When neither answers.
		 */
		async garageEndpoints(): Promise<GarageEndpoints> {
			const candidates: GarageEndpoints[] = [
				{
					admin: `http://127.0.0.1:${GARAGE_ADMIN_HOST_PORT}`,
					s3: `http://127.0.0.1:${GARAGE_S3_HOST_PORT}`,
				},
				{
					admin: `http://${GARAGE_CONTAINER_NAME}:${GARAGE_ADMIN_PORT}`,
					s3: `http://${GARAGE_CONTAINER_NAME}:${GARAGE_S3_PORT}`,
				},
			];
			if (await this.selfContainer()) {
				candidates.reverse();
			}
			for (const candidate of candidates) {
				// oxlint-disable-next-line no-await-in-loop -- the first reachable address wins
				const response = await fetch(`${candidate.admin}/health`, {
					signal: AbortSignal.timeout(2000),
				}).catch(() => null);
				if (response) {
					return candidate;
				}
			}
			throw new Error(
				`Garage isn't reachable at ${candidates.map((candidate) => candidate.admin).join(" or ")}.`,
			);
		}
	};
}
