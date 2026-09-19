import { PassThrough, type Readable } from "node:stream";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
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

function isNotFoundError(error: unknown): boolean {
	return (error as { statusCode?: number } | null)?.statusCode === 404;
}

function collect(stream: PassThrough): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const chunks: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
		stream.on("error", reject);
		stream.on("end", () =>
			resolvePromise(Buffer.concat(chunks).toString("utf8")),
		);
	});
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
		/**
		 * Pulls the mirror registry image if it isn't already present, then
		 * creates and starts its container: bound to the mirror's storage
		 * volume, on the shared network, published on a loopback-only host
		 * port, with deletes enabled and an `unless-stopped` restart policy.
		 * Waits a short grace period for it to come up before returning.
		 */
		async #createMirror(desired?: RegistryDesiredState): Promise<void> {
			const docker = this.getDocker();
			try {
				await docker.getImage(`${MIRROR_IMAGE}:${MIRROR_IMAGE_TAG}`).inspect();
			} catch {
				await this.pullImage({ image: MIRROR_IMAGE, tag: MIRROR_IMAGE_TAG });
			}
			const state = desired ?? (await this.registryDesiredState());
			const container = await docker.createContainer({
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
				Image: `${MIRROR_IMAGE}:${MIRROR_IMAGE_TAG}`,
				Labels: registryLabels(state),
				name: MIRROR_CONTAINER_NAME,
			});
			await container.start();
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
			const container = this.getDocker().getContainer(MIRROR_CONTAINER_NAME);
			const info = await container.inspect().catch((err) => {
				if (isNotFoundError(err)) {
					return null;
				}
				throw err;
			});
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
					await container.start();
					await sleep(MIRROR_START_GRACE_MS);
				}
				return;
			}
			logger.info(
				`Recreating ${MIRROR_CONTAINER_NAME} (auth=${desired.authEnabled}, host=${desired.publicHost ?? "internal"}); ${MIRROR_VOLUME} keeps its data.`,
			);
			await container.remove({ force: true });
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
			const container = this.getDocker().getContainer(MIRROR_CONTAINER_NAME);
			let info: Awaited<ReturnType<typeof container.inspect>>;
			try {
				info = await container.inspect();
			} catch (err) {
				if (!isNotFoundError(err)) {
					throw err;
				}
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
				await container.remove({ force: true });
				await this.#createMirror(desired);
				return;
			}
			if (!info.NetworkSettings?.Networks?.[config.docker.networkName]) {
				await this.getDocker()
					.getNetwork(config.docker.networkName)
					.connect({ Container: info.Id });
			}
			if (!info.State?.Running) {
				await container.start();
				await sleep(MIRROR_START_GRACE_MS);
			}
		}

		/** Whether the image mirror container exists and is currently running. */
		async imageMirrorRunning(): Promise<boolean> {
			const info = await this.getDocker()
				.getContainer(MIRROR_CONTAINER_NAME)
				.inspect()
				.catch((err) => {
					if (isNotFoundError(err)) {
						return null;
					}
					throw err;
				});
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

		/** Runs `cmd` inside the running mirror container via `docker exec`, returning its demuxed stdout/stderr and exit code. */
		async execInImageMirror(cmd: string[]): Promise<MirrorExecResult> {
			const docker = this.getDocker();
			const exec = await docker.getContainer(MIRROR_CONTAINER_NAME).exec({
				AttachStderr: true,
				AttachStdout: true,
				Cmd: cmd,
			});
			const raw = (await exec.start({
				hijack: true,
				stdin: false,
			})) as unknown as Readable;
			const stdoutStream = new PassThrough();
			const stderrStream = new PassThrough();
			const stdout = collect(stdoutStream);
			const stderr = collect(stderrStream);
			docker.modem.demuxStream(raw, stdoutStream, stderrStream);
			await new Promise<void>((resolvePromise, reject) => {
				raw.on("end", resolvePromise);
				raw.on("close", resolvePromise);
				raw.on("error", reject);
			});
			stdoutStream.end();
			stderrStream.end();
			const inspected = await exec.inspect();
			return {
				exitCode: inspected.ExitCode ?? 0,
				stderr: await stderr,
				stdout: await stdout,
			};
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
			const info = await this.getDocker()
				.info()
				.catch(() => null);
			return isRootlessDaemon(info?.SecurityOptions);
		}
	};
}
