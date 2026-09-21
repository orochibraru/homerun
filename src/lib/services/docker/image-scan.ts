import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import { isNotFound } from "$lib/server/worker-client";
import { decryptSecret } from "../secrets.ts";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams, RegistryAuth } from "./containers.ts";
import type { SelfContainer } from "./core-services.ts";
import {
	isRootlessDaemon,
	MIRROR_AUTH_DIR,
	MIRROR_AUTH_FILE,
	MIRROR_AUTH_VOLUME,
	MIRROR_CONTAINER_NAME,
	MIRROR_HOST_PORT,
	MIRROR_IMAGE,
	MIRROR_IMAGE_TAG,
	MIRROR_INTERNAL_PORT,
	MIRROR_STORAGE_DIR,
	MIRROR_VOLUME,
	type MirrorRefs,
	REGISTRY_INTERNAL_USERNAME,
	type TrivySource,
} from "./image-scan-refs.ts";
import { MirrorRegistryClient, parseDuKilobytes } from "./mirror-registry.ts";
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";
import {
	type RegistryDesiredState,
	registryEnv,
	registryLabels,
	registryMatches,
} from "./registry-container.ts";

const logger = new Logger("ImageScan");

const MIRROR_START_GRACE_MS = 1500;

interface RequiresOneOffMixin {
	ensureSharedNetwork: () => Promise<void>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
	runOneOff: (params: OneOffRunParams) => Promise<OneOffRunResult>;
	selfContainer: () => Promise<SelfContainer | null>;
}

interface MirrorInspect {
	Config?: { Env?: string[]; Labels?: Record<string, string> };
	Id: string;
	NetworkSettings?: { Networks?: Record<string, unknown> };
	State?: { Running?: boolean };
}

export interface MirrorExecResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

export interface MirrorCopyResult {
	digest: string | null;
	refs: MirrorRefs;
}

export interface ScanImageParams {
	auth?: RegistryAuth;
	ref: string;
	source: TrivySource;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Manages this app's built-in image mirror (a local registry container that
 * scanning and cross-host builds pull from instead of the original
 * registry) and runs Trivy vulnerability scans against images. Requires the
 * one-off mixin ahead of it in the merge chain (see docker.service.ts):
 * mirror copies and scans both run as one-off containers via `runOneOff`.
 */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerImageScanMixin<
	TBase extends Constructor<BaseDockerService & RequiresOneOffMixin>,
>(Base: TBase) {
	return class DockerImageScanService extends Base {
		/** The mirror container's inspect body, or null when it doesn't exist. */
		async #inspectMirror(): Promise<MirrorInspect | null> {
			return await this.worker
				.get<MirrorInspect>(`/v1/containers/${MIRROR_CONTAINER_NAME}/inspect`)
				.catch((err: unknown) => {
					if (isNotFound(err)) {
						return null;
					}
					throw err;
				});
		}

		/** Starts the mirror container and waits out the grace period it needs before it answers. */
		async #startMirror(id: string): Promise<void> {
			await this.worker.post(`/v1/containers/${id}/start`);
			await sleep(MIRROR_START_GRACE_MS);
		}

		/**
		 * Pulls the mirror registry image if it isn't already present, then
		 * creates and starts its container: bound to the mirror's storage
		 * volume, on the shared network, published on a loopback-only host
		 * port, with deletes enabled and an `unless-stopped` restart policy.
		 * Waits a short grace period for it to come up before returning.
		 */
		async #createMirror(desired?: RegistryDesiredState): Promise<void> {
			const image = `${MIRROR_IMAGE}:${MIRROR_IMAGE_TAG}`;
			const present = await this.worker.get<{ id: string | null }>(
				"/v1/images/id",
				{ ref: image },
			);
			if (!present.id) {
				await this.pullImage({ image: MIRROR_IMAGE, tag: MIRROR_IMAGE_TAG });
			}
			const state = desired ?? (await this.registryDesiredState());
			const created = await this.worker.post<{ id: string }>("/v1/containers", {
				body: {
					Env: registryEnv(state),
					ExposedPorts: { [`${MIRROR_INTERNAL_PORT}/tcp`]: {} },
					HostConfig: {
						Binds: [
							`${MIRROR_VOLUME}:${MIRROR_STORAGE_DIR}`,
							`${MIRROR_AUTH_VOLUME}:${MIRROR_AUTH_DIR}`,
						],
						NetworkMode: config.docker.networkName,
						PortBindings: {
							[`${MIRROR_INTERNAL_PORT}/tcp`]: [
								{ HostIp: "127.0.0.1", HostPort: String(MIRROR_HOST_PORT) },
							],
						},
						RestartPolicy: { Name: "unless-stopped" },
					},
					Image: image,
					Labels: registryLabels(state),
				},
				name: MIRROR_CONTAINER_NAME,
			});
			await this.worker.post(`/v1/containers/${created.id}/start`);
			logger.info(
				`Image mirror created: ${MIRROR_CONTAINER_NAME} on 127.0.0.1:${MIRROR_HOST_PORT}`,
			);
			await sleep(MIRROR_START_GRACE_MS);
		}

		/**
		 * The credentials Homerun's own mirror copies, pulls and scans use once
		 * the registry requires auth, or null while it's still anonymous. Read
		 * from instance settings rather than through RegistryService, which sits
		 * above this mixin and would make the import circular.
		 */
		async registryInternalAuth(): Promise<RegistryAuth | null> {
			const settings = (await InstanceSettingsDTO.get()).toJSON();
			if (
				settings.registryAuthEnabled !== true ||
				!settings.registryInternalSecretEnc
			) {
				return null;
			}
			const password = decryptSecret(settings.registryInternalSecretEnc);
			return password
				? { password, username: REGISTRY_INTERNAL_USERNAME }
				: null;
		}

		/**
		 * The registry settings the container should currently be running with.
		 * Read from the instance settings rather than passed in, so any caller
		 * that just wants the mirror up (a scan, a deploy) keeps whatever the
		 * Registry page configured.
		 */
		async registryDesiredState(): Promise<RegistryDesiredState> {
			const settings = (await InstanceSettingsDTO.get()).toJSON();
			return {
				authEnabled: settings.registryAuthEnabled === true,
				publicHost: settings.registryPublicHost ?? null,
			};
		}

		/**
		 * Writes the registry's htpasswd file into its auth volume, through a
		 * one-off container: the app can't write into another container's volume
		 * directly, and the file has to outlive the registry container itself.
		 * Empty content removes the file, which is how auth gets turned off.
		 */
		async writeRegistryHtpasswd(content: string): Promise<void> {
			await this.runOneOff({
				binds: [`${MIRROR_AUTH_VOLUME}:${MIRROR_AUTH_DIR}`],
				cmd: [
					"sh",
					"-c",
					content
						? `printf '%s\\n' "$HTPASSWD" > ${MIRROR_AUTH_FILE}`
						: `rm -f ${MIRROR_AUTH_FILE}`,
				],
				envVars: { HTPASSWD: content },
				image: "alpine",
				tag: "3",
			});
		}

		/**
		 * Brings the registry container in line with `desired`, recreating it
		 * when its auth env or Traefik labels have changed. The storage volume
		 * isn't touched, so every image in the registry survives.
		 */
		async reconcileRegistry(desired: RegistryDesiredState): Promise<void> {
			await this.ensureSharedNetwork();
			const info = await this.#inspectMirror();
			if (!info) {
				await this.#createMirror(desired);
				return;
			}
			if (
				registryMatches(
					info.Config?.Env ?? [],
					info.Config?.Labels ?? {},
					desired,
				)
			) {
				if (!info.State?.Running) {
					await this.#startMirror(info.Id);
				}
				return;
			}
			logger.info(
				`Recreating ${MIRROR_CONTAINER_NAME} (auth=${desired.authEnabled}, host=${desired.publicHost ?? "internal"}); ${MIRROR_VOLUME} keeps its data.`,
			);
			await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
			await this.#createMirror(desired);
		}

		/**
		 * Idempotently makes sure the image mirror is up and correctly
		 * configured: creates it (via `#createMirror`) if missing, recreates
		 * it if it predates delete support (the storage volume, and so its
		 * data, survives that recreation), reattaches it to the shared
		 * network if needed, and starts it if it's stopped.
		 */
		async ensureImageMirror(): Promise<void> {
			await this.ensureSharedNetwork();
			const info = await this.#inspectMirror();
			if (!info) {
				await this.#createMirror();
				return;
			}
			const desired = await this.registryDesiredState();
			if (
				!registryMatches(
					info.Config?.Env ?? [],
					info.Config?.Labels ?? {},
					desired,
				)
			) {
				logger.info(
					`Recreating ${MIRROR_CONTAINER_NAME} to match its settings; ${MIRROR_VOLUME} keeps its data.`,
				);
				await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
				await this.#createMirror(desired);
				return;
			}
			if (!info.NetworkSettings?.Networks?.[config.docker.networkName]) {
				await this.worker.post(`/v1/containers/${info.Id}/connect`, {
					aliases: [],
					network: config.docker.networkName,
				});
			}
			if (!info.State?.Running) {
				await this.#startMirror(info.Id);
			}
		}

		/** Whether the image mirror container exists and is currently running. */
		async imageMirrorRunning(): Promise<boolean> {
			const info = await this.#inspectMirror();
			return info?.State?.Running === true;
		}

		/**
		 * A `MirrorRegistryClient` pointed at whichever of the mirror's two
		 * addresses (loopback host port, or its in-network container name)
		 * actually answers a ping from here, authenticated as the internal
		 * token when registry auth is on. Tries the loopback address
		 * first, unless this app is itself running in a container (see
		 * `selfContainer`), in which case the in-network address is tried
		 * first.
		 *
		 * @throws When neither address responds.
		 */
		async imageMirrorClient(): Promise<MirrorRegistryClient> {
			const candidates = [
				`http://127.0.0.1:${MIRROR_HOST_PORT}`,
				`http://${MIRROR_CONTAINER_NAME}:${MIRROR_INTERNAL_PORT}`,
			];
			if (await this.selfContainer()) {
				candidates.reverse();
			}
			const auth = await this.registryInternalAuth();
			for (const url of candidates) {
				const client = new MirrorRegistryClient(url, fetch, auth);
				// oxlint-disable-next-line no-await-in-loop -- the first reachable address wins
				if (await client.ping()) {
					return client;
				}
			}
			throw new Error(
				`The mirror's registry API isn't reachable at ${candidates.join(" or ")}.`,
			);
		}

		/** Runs `cmd` inside the running mirror container via the worker's exec route, returning its separated stdout/stderr and exit code. */
		async execInImageMirror(cmd: string[]): Promise<MirrorExecResult> {
			return await this.worker.post<MirrorExecResult>("/v1/exec", {
				cmd,
				container: MIRROR_CONTAINER_NAME,
			});
		}

		/**
		 * The mirror's storage directory disk usage in bytes, via `du -sk`
		 * run inside the mirror container. Null when the mirror isn't
		 * running or `du` failed.
		 */
		async imageMirrorUsageBytes(): Promise<number | null> {
			if (!(await this.imageMirrorRunning())) {
				return null;
			}
			const result = await this.execInImageMirror([
				"du",
				"-sk",
				MIRROR_STORAGE_DIR,
			]);
			return result.exitCode === 0 ? parseDuKilobytes(result.stdout) : null;
		}

		/** Whether the local daemon is rootless Docker, which can't pull from the mirror's loopback port. */
		async isRootlessDocker(): Promise<boolean> {
			const info = await this.worker
				.get<{ SecurityOptions?: string[] | null }>("/v1/info")
				.catch(() => null);
			return isRootlessDaemon(info?.SecurityOptions);
		}
	};
}
