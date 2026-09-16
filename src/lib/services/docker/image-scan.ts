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
	skopeoCopyCommand,
	TRIVY_CACHE_VOLUME,
	TRIVY_IMAGE,
	TRIVY_TAG,
	type TrivySource,
	trivyImageCommand,
} from "./image-scan-refs.ts";
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerImageScanMixin<
	TBase extends Constructor<BaseDockerService & RequiresOneOffMixin>,
>(Base: TBase) {
	return class DockerImageScanService extends Base {
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

		async restartImageMirror(): Promise<void> {
			await this.getDocker().getContainer(MIRROR_CONTAINER_NAME).restart();
			await sleep(MIRROR_START_GRACE_MS);
		}

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
