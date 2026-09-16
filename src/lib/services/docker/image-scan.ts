import { hostname } from "node:os";
import { config } from "$lib/config";
import { summarizeTrivyReport, type TrivySummary } from "$lib/image-scan";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams, RegistryAuth } from "./containers.ts";
import {
	extractDigest,
	lastErrorLine,
	MIRROR_CONTAINER_NAME,
	MIRROR_HOST_PORT,
	MIRROR_IMAGE,
	MIRROR_IMAGE_TAG,
	MIRROR_INTERNAL_PORT,
	MIRROR_LABEL,
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
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";

const logger = new Logger("ImageScan");

const SCAN_TIMEOUT_MS = 20 * 60 * 1000;
const MIRROR_START_GRACE_MS = 1500;

interface RequiresOneOffMixin {
	ensureSharedNetwork: () => Promise<void>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
	runOneOff: (params: OneOffRunParams) => Promise<OneOffRunResult>;
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
				Env: ["REGISTRY_STORAGE_DELETE_ENABLED=true"],
				ExposedPorts: { [`${MIRROR_INTERNAL_PORT}/tcp`]: {} },
				HostConfig: {
					Binds: [`${MIRROR_VOLUME}:/var/lib/registry`],
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
