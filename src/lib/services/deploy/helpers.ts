import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import type { ServiceDTO } from "$lib/dto/service-dto";
import type { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import type { StackDTO } from "$lib/dto/stack-dto";
import {
	type GitCredential,
	hasEmbeddedCredentials,
	providerForGitUrl,
} from "$lib/git-clone-url";
import { DEPLOY_LOG_SCOPE, Logger } from "$lib/logger";
import { serviceHostname, syncDns } from "../dns.service.ts";
import type { RegistryAuth } from "../docker/containers.ts";
import { decryptSecret } from "../secrets.ts";
import type { CacheRegistryCredentials } from "./plan.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

export type ServiceMounts = Awaited<
	ReturnType<typeof ServiceVolumeDTO.listForService>
>;

export async function syncAutoDns(
	svc: ServiceDTO,
	stack: StackDTO | null,
	dep: DeploymentDTO,
): Promise<void> {
	if (!svc.dnsResolvable) {
		return;
	}
	const row = svc.toJSON();
	const hostnames = [
		serviceHostname(svc.slug, stack?.slug),
		...(row.customDomain ? [row.customDomain] : []),
	];
	const results = await syncDns(hostnames);
	if (results.length > 0) {
		await dep.appendLog(
			results
				.map(
					(result) =>
						`${result.ok ? "DNS" : "DNS failed"} (${result.provider}): ${result.detail}`,
				)
				.join("\n"),
		);
	}
	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0) {
		logger.warn(
			`DNS sync incomplete: service=${svc.id} ${failed
				.map((result) => `${result.provider}=${result.detail}`)
				.join(" ")}`,
		);
	}
}

export function toVolumeParams(mounts: ServiceMounts) {
	return mounts.map((m) => ({
		containerPath: m.mount.toJSON().containerPath,
		readOnly: m.mount.toJSON().readOnly,
		source: m.volumeSource,
	}));
}

export function registryAuth(registry: CacheRegistryCredentials): RegistryAuth {
	return {
		password: registry.password,
		serveraddress: registry.registryUrl,
		username: registry.username,
	};
}

export async function resolveGitCredential(
	gitUrl: string,
	userId: string,
): Promise<GitCredential | null> {
	if (hasEmbeddedCredentials(gitUrl)) {
		return null;
	}
	const settings = await InstanceSettingsDTO.get();
	const provider = providerForGitUrl(
		gitUrl,
		settings.gitProviders.filter((p) => p.enabled),
	);
	if (!provider) {
		return null;
	}
	const connection = await GitConnectionDTO.getForUserAndProvider(
		userId,
		provider.id,
	);
	if (!connection) {
		return null;
	}
	const token = decryptSecret(connection.accessTokenEnc);
	if (!token) {
		return null;
	}
	return {
		token,
		username: connection.toJSON().providerUsername || "oauth2",
	};
}
