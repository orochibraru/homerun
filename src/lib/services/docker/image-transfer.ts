import type { Readable } from "node:stream";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";

const logger = new Logger("Docker");

/** Mixin moving images between daemons without a registry : `docker save` on one side piped into `docker load` on the other. */
export function DockerImageTransferMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerImageTransferService extends Base {
		/**
		 * Loads a `docker save` tarball into the local daemon, consuming the
		 * stream as it arrives rather than buffering it.
		 *
		 * @throws When the daemon rejects the archive.
		 */
		async loadImageArchive(archive: Readable): Promise<void> {
			const docker = this.getDocker();
			const progress = await docker.loadImage(archive);
			await new Promise<void>((resolvePromise, reject) => {
				docker.modem.followProgress(progress, (err: Error | null) =>
					err ? reject(err) : resolvePromise(),
				);
			});
		}

		/**
		 * Streams `ref` from a remote Docker daemon (a build server) into the
		 * local one, keeping its name and tag.
		 *
		 * @throws When the image doesn't exist on the remote daemon, or the
		 *   save or load fails.
		 */
		async copyImageFromRemote(
			ref: string,
			remote: RemoteHostConnection,
		): Promise<void> {
			const archive = (await this.getDocker(remote)
				.getImage(ref)
				.get()) as unknown as Readable;
			await this.loadImageArchive(archive);
			logger.info(`Image copied from remote host=${remote.id}: ${ref}`);
		}
	};
}
