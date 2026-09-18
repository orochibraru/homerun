import { config } from "$lib/config";
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
import { serviceHostnames } from "$lib/service-domains";
import { syncDns } from "../dns.service.ts";
import { GitProviderService } from "../git-provider.service.ts";

const logger = new Logger(DEPLOY_LOG_SCOPE);

export type ServiceMounts = Awaited<
	ReturnType<typeof ServiceVolumeDTO.listForService>
>;

/**
 * Syncs DNS for every hostname a service routes, through
 * whichever DNS provider is configured, after a successful deploy. No-op
 * when the service isn't DNS-resolvable. Appends a result line per hostname
 * to the deployment's log, and logs a warning for any provider failure
 * rather than throwing : DNS sync is best-effort, it never fails the deploy.
 */
export async function syncAutoDns(
	svc: ServiceDTO,
	stack: StackDTO | null,
	dep: DeploymentDTO,
): Promise<void> {
	if (!svc.dnsResolvable) {
		return;
	}
	const hostnames = serviceHostnames(
		svc.toJSON(),
		stack?.slug,
		config.baseDomain,
	);
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

/** Shapes a service's resolved volume mounts into the params `DockerService`'s container/swarm create calls expect. */
export function toVolumeParams(mounts: ServiceMounts) {
	return mounts.map((m) => ({
		containerPath: m.mount.toJSON().containerPath,
		readOnly: m.mount.toJSON().readOnly,
		source: m.volumeSource,
	}));
}

/**
 * Resolves the credential a git build/clone of `gitUrl` should use. Returns
 * null when the URL already embeds credentials, when no enabled git provider
 * matches the host, when the user has no connection to that provider, or
 * when the connection's stored token can't be decrypted : any of those mean
 * the clone is attempted without auth (fine for a public repo).
 */
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
	const token = await GitProviderService.accessToken(provider, connection);
	if (!token) {
		return null;
	}
	return {
		token,
		username: connection.toJSON().providerUsername || "oauth2",
	};
}
