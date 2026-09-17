import { hostname } from "node:os";
import { PassThrough, type Readable } from "node:stream";
import { config } from "$lib/config";
import { summarizeTrivyReport, type TrivySummary } from "$lib/image-scan";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams, RegistryAuth } from "./containers.ts";
import type { SelfContainer } from "./core-services.ts";
import {
	extractDigest,
	isRootlessDaemon,
	lastErrorLine,
	MIRROR_CONFIG_PATH,
	MIRROR_CONTAINER_NAME,
	MIRROR_DELETE_ENV,
	MIRROR_HOST_PORT,
	MIRROR_IMAGE,
	MIRROR_IMAGE_TAG,
	MIRROR_INTERNAL_PORT,
	MIRROR_LABEL,
	MIRROR_REPOSITORIES_DIR,
	MIRROR_STORAGE_DIR,
	MIRROR_VOLUME,
	type MirrorRefs,
	mirrorRefs,
	normalizeImageRef,
	REGISTRY_AUTH_ENV,
	registryAuthFile,
	SKOPEO_IMAGE,
	SKOPEO_TAG,
	skopeoArchiveCommand,
	skopeoCopyCommand,
	TRIVY_CACHE_VOLUME,
	TRIVY_IMAGE,
	TRIVY_TAG,
	type TrivySource,
	trivyImageCommand,
} from "./image-scan-refs.ts";
import { MANAGED_LABEL } from "./labels.ts";
import {
	isValidRepository,
	MirrorRegistryClient,
	parseDuKilobytes,
} from "./mirror-registry.ts";
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";

const logger = new Logger("ImageScan");

const SCAN_TIMEOUT_MS = 20 * 60 * 1000;
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

export interface MirrorCopyParams {
	auth?: RegistryAuth;
	image: string;
	tag: string;
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

function output(result: OneOffRunResult): string {
	return `${result.stderr.toString("utf8")}\n${result.stdout.toString("utf8")}`;
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
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
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
		async #createMirror(): Promise<void> {
			const docker = this.getDocker();
			try {
				await docker.getImage(`${MIRROR_IMAGE}:${MIRROR_IMAGE_TAG}`).inspect();
			} catch {
				await this.pullImage({ image: MIRROR_IMAGE, tag: MIRROR_IMAGE_TAG });
			}
			const container = await docker.createContainer({
				Env: [MIRROR_DELETE_ENV],
				ExposedPorts: { [`${MIRROR_INTERNAL_PORT}/tcp`]: {} },
				HostConfig: {
					Binds: [`${MIRROR_VOLUME}:${MIRROR_STORAGE_DIR}`],
					NetworkMode: config.docker.networkName,
					PortBindings: {
						[`${MIRROR_INTERNAL_PORT}/tcp`]: [
							{ HostIp: "127.0.0.1", HostPort: String(MIRROR_HOST_PORT) },
						],
					},
					RestartPolicy: { Name: "unless-stopped" },
				},
				Image: `${MIRROR_IMAGE}:${MIRROR_IMAGE_TAG}`,
				Labels: { [MIRROR_LABEL]: "mirror" },
				name: MIRROR_CONTAINER_NAME,
			});
			await container.start();
			logger.info(
				`Image mirror created: ${MIRROR_CONTAINER_NAME} on 127.0.0.1:${MIRROR_HOST_PORT}`,
			);
			await sleep(MIRROR_START_GRACE_MS);
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
			if (!info.Config?.Env?.includes(MIRROR_DELETE_ENV)) {
				logger.info(
					`Recreating ${MIRROR_CONTAINER_NAME} with deletes enabled; ${MIRROR_VOLUME} keeps its data.`,
				);
				await container.remove({ force: true });
				await this.#createMirror();
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
		 * actually answers a ping from here. Tries the loopback address
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
			for (const url of candidates) {
				const client = new MirrorRegistryClient(url);
				// biome-ignore lint/performance/noAwaitInLoops: the first reachable address wins
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

		/**
		 * Runs the mirror registry's own `garbage-collect --delete-untagged`
		 * inside the mirror container, reclaiming blobs left behind by
		 * deleted or untagged manifests. Returns the command's combined
		 * output.
		 *
		 * @throws When the command exits non-zero.
		 */
		async garbageCollectImageMirror(): Promise<string> {
			const result = await this.execInImageMirror([
				"registry",
				"garbage-collect",
				"--delete-untagged",
				MIRROR_CONFIG_PATH,
			]);
			if (result.exitCode !== 0) {
				throw new Error(
					`registry garbage-collect failed: ${lastErrorLine(`${result.stderr}\n${result.stdout}`)}`,
				);
			}
			return `${result.stdout}${result.stderr}`;
		}

		/**
		 * Deletes the given repositories' on-disk directories inside the
		 * mirror (silently skipping any name that doesn't look like a valid
		 * repository path), then prunes any parent directories left empty by
		 * that removal.
		 *
		 * @throws When the initial removal fails.
		 */
		async removeImageMirrorRepositories(names: string[]): Promise<void> {
			const paths = names
				.filter(isValidRepository)
				.map((name) => `${MIRROR_REPOSITORIES_DIR}/${name}`);
			if (paths.length === 0) {
				return;
			}
			const result = await this.execInImageMirror(["rm", "-rf", ...paths]);
			if (result.exitCode !== 0) {
				throw new Error(
					`Removing empty mirror repositories failed: ${lastErrorLine(result.stderr)}`,
				);
			}
			await this.execInImageMirror([
				"find",
				MIRROR_REPOSITORIES_DIR,
				"-mindepth",
				"1",
				"-type",
				"d",
				"-empty",
				"-delete",
			]);
		}

		/** Restarts the mirror container and waits the usual startup grace period. */
		async restartImageMirror(): Promise<void> {
			await this.getDocker().getContainer(MIRROR_CONTAINER_NAME).restart();
			await sleep(MIRROR_START_GRACE_MS);
		}

		/**
		 * Ensures the image mirror is up, then runs `skopeo copy` in a
		 * one-off container to copy `image:tag` from its source registry
		 * into the mirror under a derived internal ref, optionally
		 * authenticating against the source registry.
		 *
		 * @returns The copied image's digest (when skopeo reported one) and
		 *   the computed mirror refs.
		 * @throws When the copy times out or exits non-zero.
		 */
		async copyToMirror(params: MirrorCopyParams): Promise<MirrorCopyResult> {
			await this.ensureImageMirror();
			const refs = mirrorRefs(params.image, params.tag);
			const auth = params.auth;
			const command = skopeoCopyCommand({
				destination: refs.internalRef,
				source: refs.sourceRef,
				withAuth: auth !== undefined,
			});
			const result = await this.runOneOff({
				cmd: command.cmd,
				entrypoint: command.entrypoint,
				envVars: auth
					? {
							[REGISTRY_AUTH_ENV]: registryAuthFile(
								normalizeImageRef(params.image, params.tag).registry,
								auth,
							),
						}
					: undefined,
				image: SKOPEO_IMAGE,
				networkName: config.docker.networkName,
				tag: SKOPEO_TAG,
				timeoutMs: SCAN_TIMEOUT_MS,
			});
			if (result.timedOut || result.exitCode !== 0) {
				throw new Error(
					result.timedOut
						? "copying the image into the mirror timed out"
						: lastErrorLine(output(result)),
				);
			}
			return { digest: extractDigest(result.stdout.toString("utf8")), refs };
		}

		/**
		 * Pulls an image back out of the mirror via its loopback ref, then
		 * re-tags it locally as `target.image:target.tag` so callers can
		 * address it by its real name rather than the mirror's internal one.
		 */
		async pullFromMirror(
			refs: MirrorRefs,
			target: { image: string; tag: string },
			onProgress?: (line: string) => void,
		): Promise<{ digest: string | null }> {
			const pulled = await this.pullImage({
				image: refs.loopbackImage,
				onProgress,
				tag: refs.loopbackTag,
			});
			await this.getDocker()
				.getImage(`${refs.loopbackImage}:${refs.loopbackTag}`)
				.tag({ repo: target.image, tag: target.tag });
			return pulled;
		}

		/** Kills a helper container, ignoring a container that already stopped or is gone. */
		async #killQuietly(containerId: string): Promise<void> {
			await this.getDocker()
				.getContainer(containerId)
				.kill()
				.catch(() => undefined);
		}

		/** Pipes a `docker save` tarball into the local daemon's image load, resolving once the load finishes. */
		async #loadArchive(archive: Readable): Promise<void> {
			const docker = this.getDocker();
			const progress = await docker.loadImage(archive);
			await new Promise<void>((resolvePromise, reject) => {
				docker.modem.followProgress(progress, (err: Error | null) =>
					err ? reject(err) : resolvePromise(),
				);
			});
		}

		/** Whether the local daemon is rootless Docker, which can't pull from the mirror's loopback port. */
		async isRootlessDocker(): Promise<boolean> {
			const info = await this.getDocker()
				.info()
				.catch(() => null);
			return isRootlessDaemon(info?.SecurityOptions);
		}

		/**
		 * Streams an image out of the mirror into this daemon without a
		 * registry pull : a one-off skopeo container on the shared network
		 * reads it from `homerun-mirror:5000` and writes a `docker load`
		 * tarball to its stdout, which is piped straight into the daemon's
		 * image load, then tagged `target.image:target.tag`. Works wherever
		 * the daemon can't reach the loopback registry (rootless Docker).
		 *
		 * @throws When skopeo exits non-zero, the load fails, or the whole
		 *   transfer exceeds the scan timeout.
		 */
		async loadFromMirror(
			refs: MirrorRefs,
			target: { image: string; tag: string },
			onProgress?: (line: string) => void,
		): Promise<void> {
			await this.ensureImageMirror();
			const docker = this.getDocker();
			try {
				await docker.getImage(`${SKOPEO_IMAGE}:${SKOPEO_TAG}`).inspect();
			} catch {
				await this.pullImage({ image: SKOPEO_IMAGE, tag: SKOPEO_TAG });
			}
			const name = `${target.image}:${target.tag}`;
			const command = skopeoArchiveCommand({ name, source: refs.internalRef });
			const container = await docker.createContainer({
				Cmd: command.cmd,
				Entrypoint: command.entrypoint,
				HostConfig: { NetworkMode: config.docker.networkName },
				Image: `${SKOPEO_IMAGE}:${SKOPEO_TAG}`,
				Labels: { [MANAGED_LABEL]: "true" },
				Tty: false,
			});
			const raw = (await container.attach({
				stderr: true,
				stdout: true,
				stream: true,
			})) as unknown as Readable & { destroy: () => void };
			const archive = new PassThrough();
			const stderrStream = new PassThrough();
			const stderr = collect(stderrStream);
			docker.modem.demuxStream(raw, archive, stderrStream);
			const finish = () => {
				archive.end();
				stderrStream.end();
			};
			raw.on("end", finish);
			raw.on("close", finish);
			const timer = setTimeout(() => {
				container.kill().catch(() => undefined);
			}, SCAN_TIMEOUT_MS);
			try {
				onProgress?.(`Loading ${name} from the mirror...`);
				await container.start();
				const loaded = this.#loadArchive(archive);
				loaded.catch(() => this.#killQuietly(container.id));
				const [exit, load] = await Promise.allSettled([
					container.wait() as Promise<{ StatusCode: number }>,
					loaded,
				]);
				if (exit.status === "rejected") {
					throw exit.reason;
				}
				const skopeoOutput = (await stderr).trim();
				if (exit.value.StatusCode !== 0 && skopeoOutput) {
					throw new Error(lastErrorLine(skopeoOutput));
				}
				if (load.status === "rejected") {
					throw load.reason;
				}
				if (exit.value.StatusCode !== 0) {
					throw new Error(`skopeo exited with code ${exit.value.StatusCode}`);
				}
				await docker.getImage(name).inspect();
				logger.info(`Image loaded from the mirror: ${name}`);
			} finally {
				clearTimeout(timer);
				raw.destroy();
				await container.remove({ force: true }).catch((err) => {
					logger.warn(
						`Couldn't remove mirror load container ${container.id}`,
						err,
					);
				});
			}
		}

		/**
		 * The Docker socket path as it exists on the real host, resolved by
		 * inspecting this app's own container's mounts for wherever
		 * `config.docker.socketPath` is bound from. Needed because
		 * `scanImage` bind-mounts the socket into a scanner container, and
		 * when this app is itself containerized the path visible inside its
		 * own container can differ from the real host path. Falls back to
		 * `config.docker.socketPath` unchanged when it can't be resolved.
		 */
		async #hostSocketPath(): Promise<string> {
			const info = await this.getDocker()
				.getContainer(hostname())
				.inspect()
				.catch(() => null);
			const mount = info?.Mounts?.find(
				(entry) => entry.Destination === config.docker.socketPath,
			);
			return mount?.Source ?? config.docker.socketPath;
		}

		/**
		 * Runs Trivy against an image reference in a one-off container on
		 * the shared network, bind-mounting the host Docker socket unless
		 * scanning a remote-source image, with registry credentials (if any)
		 * passed via env vars. Returns the summarized vulnerability report.
		 *
		 * @throws When the scan times out or Trivy exits non-zero.
		 */
		async scanImage(params: ScanImageParams): Promise<TrivySummary> {
			const binds = [`${TRIVY_CACHE_VOLUME}:/root/.cache`];
			if (params.source.kind !== "remote") {
				binds.push(`${await this.#hostSocketPath()}:/var/run/docker.sock`);
			}
			await this.ensureSharedNetwork();
			const result = await this.runOneOff({
				binds,
				cmd: trivyImageCommand(params.ref, params.source),
				envVars: params.auth
					? {
							TRIVY_PASSWORD: params.auth.password,
							TRIVY_USERNAME: params.auth.username,
						}
					: undefined,
				image: TRIVY_IMAGE,
				networkName: config.docker.networkName,
				tag: TRIVY_TAG,
				timeoutMs: SCAN_TIMEOUT_MS,
			});
			if (result.timedOut) {
				throw new Error("the scanner timed out");
			}
			if (result.exitCode !== 0) {
				throw new Error(lastErrorLine(result.stderr.toString("utf8")));
			}
			return summarizeTrivyReport(result.stdout.toString("utf8"));
		}
	};
}
