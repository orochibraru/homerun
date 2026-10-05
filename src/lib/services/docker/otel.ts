import { config } from "#lib/config.js";
import { Logger } from "#lib/logger.js";
import { isNotFound } from "#lib/server/worker-client.js";
import { OTEL_GRPC_PORT, OTEL_HTTP_PORT } from "#lib/tracing/env.js";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams } from "./containers.ts";
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";
import {
	OTEL_CONFIG_DIR,
	OTEL_CONFIG_FILE,
	OTEL_CONFIG_VOLUME,
	OTEL_CONTAINER_NAME,
	OTEL_IMAGE,
	OTEL_IMAGE_TAG,
	type OtelDesiredState,
	otelCollectorConfig,
	otelEnv,
	otelLabels,
	otelMatches,
} from "./otel-container.ts";

const logger = new Logger("OtelCollector");

interface RequiresOtelDeps {
	ensureSharedNetwork: () => Promise<void>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
	runOneOff: (params: OneOffRunParams) => Promise<OneOffRunResult>;
}

interface OtelInspect {
	Config?: { Env?: string[]; Image?: string };
	Id: string;
	State?: { Running?: boolean };
}

/**
 * Runs Homerun's OpenTelemetry collector as a core container: OTLP over gRPC
 * and HTTP on the shared network only (no published port, no Traefik route),
 * exporting every trace to the app's own ingest. Requires the one-off mixin
 * ahead of it.
 */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerOtelMixin<
	TBase extends Constructor<BaseDockerService & RequiresOtelDeps>,
>(Base: TBase) {
	return class DockerOtelService extends Base {
		/** The collector container's inspect body, or null when it doesn't exist. */
		async #inspectOtel(): Promise<OtelInspect | null> {
			return await this.worker
				.get<OtelInspect>(`/v1/containers/${OTEL_CONTAINER_NAME}/inspect`)
				.catch((err: unknown) => {
					if (isNotFound(err)) {
						return null;
					}
					throw err;
				});
		}

		/** Whether the collector container exists and is running. */
		async otelRunning(): Promise<boolean> {
			const info = await this.#inspectOtel();
			return info?.State?.Running === true;
		}

		/**
		 * Writes the collector's config file into its config volume through a
		 * one-off container, since the collector image has no shell to do it
		 * and the app can't write into another container's volume.
		 */
		async #writeOtelConfig(): Promise<void> {
			await this.runOneOff({
				binds: [`${OTEL_CONFIG_VOLUME}:${OTEL_CONFIG_DIR}`],
				cmd: ["sh", "-c", `printf '%s' "$OTEL_CONFIG" > ${OTEL_CONFIG_FILE}`],
				envVars: { OTEL_CONFIG: otelCollectorConfig() },
				image: "alpine",
				tag: "3",
			});
		}

		/** Pulls the collector's image when missing, then creates and starts its container. */
		async #createOtel(state: OtelDesiredState): Promise<void> {
			const image = `${OTEL_IMAGE}:${OTEL_IMAGE_TAG}`;
			const present = await this.worker.get<{ id: string | null }>(
				"/v1/images/id",
				{ ref: image },
			);
			if (!present.id) {
				await this.pullImage({ image: OTEL_IMAGE, tag: OTEL_IMAGE_TAG });
			}
			await this.#writeOtelConfig();
			const created = await this.worker.post<{ id: string }>("/v1/containers", {
				body: {
					Cmd: [`--config=${OTEL_CONFIG_FILE}`],
					Env: otelEnv(state),
					ExposedPorts: {
						[`${OTEL_GRPC_PORT}/tcp`]: {},
						[`${OTEL_HTTP_PORT}/tcp`]: {},
					},
					HostConfig: {
						Binds: [`${OTEL_CONFIG_VOLUME}:${OTEL_CONFIG_DIR}:ro`],
						ExtraHosts: ["host.docker.internal:host-gateway"],
						NetworkMode: config.docker.networkName,
						RestartPolicy: { Name: "unless-stopped" },
					},
					Image: image,
					Labels: otelLabels(),
				},
				name: OTEL_CONTAINER_NAME,
			});
			await this.worker.post(`/v1/containers/${created.id}/start`);
			logger.info(`OpenTelemetry collector created: ${OTEL_CONTAINER_NAME}`);
		}

		/**
		 * Brings the collector container in line with `state`, creating it, or
		 * recreating it when its image, export address or token changed. Null
		 * stops and removes the container; its config volume stays.
		 */
		async reconcileOtel(state: OtelDesiredState | null): Promise<void> {
			const info = await this.#inspectOtel();
			if (!state) {
				if (info) {
					await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
					logger.info("OpenTelemetry collector removed.");
				}
				return;
			}
			await this.ensureSharedNetwork();
			if (!info) {
				await this.#createOtel(state);
				return;
			}
			if (otelMatches(info.Config?.Image, info.Config?.Env ?? [], state)) {
				if (!info.State?.Running) {
					await this.worker.post(`/v1/containers/${info.Id}/start`);
				}
				return;
			}
			await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
			await this.#createOtel(state);
		}
	};
}
