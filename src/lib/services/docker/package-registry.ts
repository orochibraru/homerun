import { config } from "#lib/config.js";
import { Logger } from "#lib/logger.js";
import type { PackageRegistryKind } from "#lib/package-registries.js";
import { isNotFound } from "#lib/server/worker-client.js";

import type { BaseDockerService, Constructor } from "./base.ts";
import type { PullImageParams } from "./containers.ts";
import type { OneOffRunParams, OneOffRunResult } from "./one-off.ts";
import {
	PACKAGE_REGISTRY_SPECS,
	packageRegistryConfigVolume,
	packageRegistryDataVolume,
	type PackageRegistryDesiredState,
	packageRegistryEnv,
	packageRegistryFileEnv,
	packageRegistryFileScript,
	packageRegistryLabels,
	packageRegistryMatches,
} from "./package-registry-container.ts";

const logger = new Logger("PackageRegistry");

interface RequiresPackageRegistryDeps {
	ensureSharedNetwork: () => Promise<void>;
	pullImage: (params: PullImageParams) => Promise<{ digest: string | null }>;
	runOneOff: (params: OneOffRunParams) => Promise<OneOffRunResult>;
}

interface PackageRegistryInspect {
	Config?: { Env?: string[]; Image?: string; Labels?: Record<string, string> };
	Id: string;
	State?: { Running?: boolean };
}

/**
 * Runs the language package registries (npm, PyPI) as core containers next
 * to the Docker registry: one container per kind on the shared network, a
 * data volume and a config volume each, and a Traefik router when one is
 * published at a hostname. Requires the one-off mixin ahead of it.
 */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerPackageRegistryMixin<
	TBase extends Constructor<BaseDockerService & RequiresPackageRegistryDeps>,
>(Base: TBase) {
	return class DockerPackageRegistryService extends Base {
		/** A package registry container's inspect body, or null when it doesn't exist. */
		async #inspectPackageRegistry(
			kind: PackageRegistryKind,
		): Promise<PackageRegistryInspect | null> {
			const name = PACKAGE_REGISTRY_SPECS[kind].containerName;
			return await this.worker
				.get<PackageRegistryInspect>(`/v1/containers/${name}/inspect`)
				.catch((err: unknown) => {
					if (isNotFound(err)) {
						return null;
					}
					throw err;
				});
		}

		/** Whether a package registry's container exists and is running. */
		async packageRegistryRunning(kind: PackageRegistryKind): Promise<boolean> {
			const info = await this.#inspectPackageRegistry(kind);
			return info?.State?.Running === true;
		}

		/**
		 * Writes a package registry's config files and htpasswd into its config
		 * volume through a one-off container, since the app can't write into
		 * another container's volume. Both registries reread the htpasswd file
		 * when it changes, so a token change needs no restart.
		 */
		async #writePackageRegistryFiles(
			kind: PackageRegistryKind,
			htpasswd: string,
		): Promise<void> {
			const spec = PACKAGE_REGISTRY_SPECS[kind];
			await this.runOneOff({
				binds: [`${packageRegistryConfigVolume(kind)}:${spec.configDir}`],
				cmd: ["sh", "-c", packageRegistryFileScript(kind)],
				envVars: packageRegistryFileEnv(kind, htpasswd),
				image: "alpine",
				tag: "3",
			});
		}

		/** Pulls a package registry's image when missing, then creates and starts its container. */
		async #createPackageRegistry(
			kind: PackageRegistryKind,
			state: PackageRegistryDesiredState,
		): Promise<void> {
			const spec = PACKAGE_REGISTRY_SPECS[kind];
			const image = `${spec.image}:${spec.tag}`;
			const present = await this.worker.get<{ id: string | null }>(
				"/v1/images/id",
				{ ref: image },
			);
			if (!present.id) {
				await this.pullImage({ image: spec.image, tag: spec.tag });
			}
			const created = await this.worker.post<{ id: string }>("/v1/containers", {
				body: {
					...(spec.cmd ? { Cmd: spec.cmd } : {}),
					Env: packageRegistryEnv(kind, state),
					ExposedPorts: { [`${spec.port}/tcp`]: {} },
					HostConfig: {
						Binds: [
							`${packageRegistryDataVolume(kind)}:${spec.dataDir}`,
							`${packageRegistryConfigVolume(kind)}:${spec.configDir}`,
						],
						NetworkMode: config.docker.networkName,
						RestartPolicy: { Name: "unless-stopped" },
					},
					Image: image,
					Labels: packageRegistryLabels(kind, state),
				},
				name: spec.containerName,
			});
			await this.worker.post(`/v1/containers/${created.id}/start`);
			logger.info(`Package registry created: ${spec.containerName}`);
		}

		/**
		 * Brings a package registry's container in line with `state`: rewrites
		 * its config files and htpasswd, then creates it, or recreates it when
		 * its image, config or Traefik labels changed. Null stops and removes
		 * the container. The data volume is never touched, so every package
		 * survives both.
		 */
		async reconcilePackageRegistry(
			kind: PackageRegistryKind,
			state: PackageRegistryDesiredState | null,
		): Promise<void> {
			const info = await this.#inspectPackageRegistry(kind);
			if (!state) {
				if (info) {
					await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
					logger.info(
						`Package registry removed, ${packageRegistryDataVolume(kind)} keeps its packages.`,
					);
				}
				return;
			}
			await this.ensureSharedNetwork();
			await this.#writePackageRegistryFiles(kind, state.htpasswd);
			if (!info) {
				await this.#createPackageRegistry(kind, state);
				return;
			}
			if (
				packageRegistryMatches(
					kind,
					{
						env: info.Config?.Env ?? [],
						image: info.Config?.Image,
						labels: info.Config?.Labels ?? {},
					},
					state,
				)
			) {
				if (!info.State?.Running) {
					await this.worker.post(`/v1/containers/${info.Id}/start`);
				}
				return;
			}
			await this.worker.delete(`/v1/containers/${info.Id}`, { force: "1" });
			await this.#createPackageRegistry(kind, state);
		}
	};
}
