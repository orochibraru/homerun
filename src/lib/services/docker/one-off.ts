import { PassThrough, type Readable } from "node:stream";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";
import type { RegistryAuth } from "./containers.ts";
import { MANAGED_LABEL } from "./labels.ts";

const logger = new Logger("Docker");

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface RequiresContainerMixin {
	pullImage: (params: {
		image: string;
		tag: string;
		auth?: RegistryAuth;
		onProgress?: (line: string) => void;
		remote?: RemoteHostConnection | null;
	}) => Promise<{ digest: string | null }>;
}

export interface OneOffRunParams {
	auth?: RegistryAuth;
	binds?: string[];
	cmd?: string[];
	entrypoint?: string[] | null;
	envVars?: Record<string, string>;
	image: string;
	labels?: Record<string, string>;
	networkName?: string | null;
	onProgress?: (line: string) => void;
	remote?: RemoteHostConnection | null;
	tag: string;
	timeoutMs?: number;
	workingDir?: string | null;
}

export interface OneOffRunResult {
	exitCode: number;
	stderr: Buffer;
	stdout: Buffer;
	timedOut: boolean;
}

function collect(stream: PassThrough): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		const chunks: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
		stream.on("error", reject);
		stream.on("end", () => resolvePromise(Buffer.concat(chunks)));
	});
}

function isNotFoundError(error: unknown): boolean {
	return (error as { statusCode?: number } | null)?.statusCode === 404;
}

export function DockerOneOffMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
>(Base: TBase) {
	return class DockerOneOffService extends Base {
		async #ensureImage(params: OneOffRunParams): Promise<void> {
			const docker = this.getDocker(params.remote);
			const ref = `${params.image}:${params.tag}`;
			try {
				await docker.getImage(ref).inspect();
				return;
			} catch (err) {
				if (!isNotFoundError(err)) {
					throw err;
				}
			}
			await this.pullImage({
				auth: params.auth,
				image: params.image,
				onProgress: params.onProgress,
				remote: params.remote,
				tag: params.tag,
			});
		}

		async runOneOff(params: OneOffRunParams): Promise<OneOffRunResult> {
			await this.#ensureImage(params);

			const docker = this.getDocker(params.remote);
			const container = await docker.createContainer({
				Cmd: params.cmd,
				Entrypoint: params.entrypoint ?? undefined,
				Env: Object.entries(params.envVars ?? {}).map(
					([key, value]) => `${key}=${value}`,
				),
				HostConfig: {
					Binds:
						params.binds && params.binds.length > 0 ? params.binds : undefined,
					NetworkMode: params.networkName ?? undefined,
				},
				Image: `${params.image}:${params.tag}`,
				Labels: { ...params.labels, [MANAGED_LABEL]: "true" },
				Tty: false,
				WorkingDir: params.workingDir ?? undefined,
			});

			const stdoutStream = new PassThrough();
			const stderrStream = new PassThrough();
			const stdoutDone = collect(stdoutStream);
			const stderrDone = collect(stderrStream);

			const raw = (await container.attach({
				stderr: true,
				stdout: true,
				stream: true,
			})) as unknown as Readable & { destroy: () => void };
			docker.modem.demuxStream(raw, stdoutStream, stderrStream);
			const streamDone = new Promise<void>((resolvePromise) => {
				raw.on("end", resolvePromise);
				raw.on("close", resolvePromise);
			});

			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				container.kill().catch(() => undefined);
			}, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

			try {
				await container.start();
				const wait = (await container.wait()) as { StatusCode: number };
				await streamDone;
				stdoutStream.end();
				stderrStream.end();
				return {
					exitCode: wait.StatusCode,
					stderr: await stderrDone,
					stdout: await stdoutDone,
					timedOut,
				};
			} finally {
				clearTimeout(timer);
				raw.destroy();
				await container.remove({ force: true }).catch((err) => {
					logger.warn(`Couldn't remove one-off container ${container.id}`, err);
				});
			}
		}
	};
}
