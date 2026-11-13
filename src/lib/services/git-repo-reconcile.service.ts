import { GitConnectionDTO } from "#lib/dto/git-connection-dto.js";
import { RepositoryDTO } from "#lib/dto/repository-dto.js";
import type { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceGitDTO } from "#lib/dto/service-git-dto.js";
import {
	parseRepoIdentity,
	renameRepoInUrl,
	repoByIdPath,
	repoByNamePath,
	type RepoIdentity,
	repoName,
} from "#lib/git-repo-identity.js";
import { Logger } from "#lib/logger.js";
import type { GitProviderConfig } from "#lib/server/db/schema.js";

import {
	enabledGitProvider,
	GitProviderService,
} from "./git-provider.service.ts";

const logger = new Logger("GitRepoReconcile");

interface RepoUse {
	fullName: string;
	id: string | null;
	providerId: string;
	userIds: string[];
}

interface Holders {
	repositories: RepositoryDTO[];
	services: ServiceDTO[];
}

/** Every repository Homerun builds from or watches, once per provider and path, with whose connections can read it. */
function repoUses({ repositories, services }: Holders): RepoUse[] {
	const uses = new Map<string, RepoUse>();
	const add = (
		providerId: string,
		fullName: string,
		id: string | null,
		userId: string,
	) => {
		const key = `${providerId}\n${fullName}`;
		const use = uses.get(key) ?? {
			fullName,
			id: null,
			providerId,
			userIds: [],
		};
		use.id ??= id;
		if (!use.userIds.includes(userId)) {
			use.userIds.push(userId);
		}
		uses.set(key, use);
	};
	for (const svc of services) {
		const row = svc.toJSON();
		if (row.gitProviderId && row.gitRepo) {
			add(row.gitProviderId, row.gitRepo, row.gitRepoId, row.userId);
		}
	}
	for (const repo of repositories) {
		add(
			repo.providerId,
			repo.fullName,
			repo.toJSON().providerRepoId,
			repo.userId,
		);
	}
	return [...uses.values()];
}

/**
 * Keeps Homerun's repositories pointing at the right place when they move
 * on their provider: an account or organization renamed, a repository
 * renamed or transferred. Each repository is read by its provider id, which
 * never changes; one Homerun hasn't learned the id of yet is read by its
 * path (providers redirect an old path for a while), and failing that,
 * matched by name among the repositories its owner's account can see. A new
 * path is written onto every service building from it (its repository and
 * clone URL) and onto the watched repository. Connected accounts get their
 * current username too.
 */
class GitRepoReconcileServiceClass {
	/** Runs one pass over every connection and every repository; one that fails is logged and doesn't stop the others. */
	async reconcileAll(): Promise<void> {
		await this.#refreshUsernames();
		const holders = {
			repositories: await RepositoryDTO.list(),
			services: await ServiceGitDTO.listFromProviderRepos(),
		};
		for (const use of repoUses(holders)) {
			// oxlint-disable-next-line no-await-in-loop -- sequential on purpose, provider APIs rate-limit per token
			await this.#reconcile(use, holders).catch((err: unknown) => {
				logger.warn(
					`Couldn't check where ${use.fullName} lives now: provider=${use.providerId} : ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		}
	}

	/** Writes each connected account's current username onto its connection, for one renamed on its provider. */
	async #refreshUsernames(): Promise<void> {
		for (const connection of await GitConnectionDTO.listAll()) {
			// oxlint-disable-next-line no-await-in-loop -- sequential on purpose, provider APIs rate-limit per token
			await this.#refreshUsername(connection).catch((err: unknown) => {
				logger.debug(
					`Couldn't read the account name: connection=${connection.id} : ${err instanceof Error ? err.message : String(err)}`,
				);
			});
		}
	}

	/** Writes one connection's current username onto it when it changed. */
	async #refreshUsername(connection: GitConnectionDTO): Promise<void> {
		const provider = await enabledGitProvider(connection.providerId);
		const name = provider
			? await GitProviderService.accountName(provider, connection)
			: null;
		if (!name || name === connection.providerUsername) {
			return;
		}
		logger.info(
			`Account renamed: ${connection.providerUsername} → ${name} connection=${connection.id}`,
		);
		await connection.update({ providerUsername: name });
	}

	/** Reads where one repository lives now, through the first of its users still connected, and moves its holders there. */
	async #reconcile(use: RepoUse, holders: Holders): Promise<void> {
		const provider = await enabledGitProvider(use.providerId);
		const connections = provider
			? await Promise.all(
					use.userIds.map((userId) =>
						GitConnectionDTO.getForUserAndProvider(userId, provider.id),
					),
				)
			: [];
		const connection = connections.find((candidate) => candidate !== null);
		if (!(provider && connection)) {
			return;
		}
		const current = await this.#locate(provider, connection, use);
		if (current) {
			await this.#move(use, current, holders);
		}
	}

	/**
	 * The repository's id and current path: by id when known, else by path,
	 * else the one repository the account sees with the same name. Null
	 * when it can't be found, which leaves it as it is.
	 */
	async #locate(
		provider: GitProviderConfig,
		connection: GitConnectionDTO,
		use: RepoUse,
	): Promise<RepoIdentity | null> {
		if (use.id) {
			return await this.#read(
				provider,
				connection,
				repoByIdPath(provider.kind, use.id),
			);
		}
		const byPath = await this.#read(
			provider,
			connection,
			repoByNamePath(provider.kind, use.fullName),
		);
		if (byPath) {
			return byPath;
		}
		const name = repoName(use.fullName).toLowerCase();
		const matches = (
			await GitProviderService.listRepos(provider, connection)
		).filter((repo) => repoName(repo.fullName).toLowerCase() === name);
		if (matches.length !== 1) {
			return null;
		}
		return await this.#read(
			provider,
			connection,
			repoByNamePath(provider.kind, matches[0].fullName),
		);
	}

	/**
	 * One repository from the provider's API, null when it answers 404.
	 *
	 * @throws When the provider refuses or answers another error.
	 */
	async #read(
		provider: GitProviderConfig,
		connection: GitConnectionDTO,
		path: string,
	): Promise<RepoIdentity | null> {
		try {
			const res = await GitProviderService.api(provider, connection, path);
			return parseRepoIdentity(provider.kind, await res.json());
		} catch (err) {
			if (err instanceof Error && err.message.includes("answered 404")) {
				return null;
			}
			throw err;
		}
	}

	/** Writes the repository's id and current path onto each service and watched repository still holding something else. */
	async #move(
		use: RepoUse,
		current: RepoIdentity,
		{ repositories, services }: Holders,
	): Promise<void> {
		const moved = current.fullName !== use.fullName;
		for (const svc of services) {
			const row = svc.toJSON();
			if (
				row.gitProviderId !== use.providerId ||
				row.gitRepo !== use.fullName ||
				(!moved && row.gitRepoId === current.id)
			) {
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- one update per service
			await svc.update({
				gitRepo: current.fullName,
				gitRepoId: current.id,
				gitUrl: row.gitUrl
					? renameRepoInUrl(row.gitUrl, use.fullName, current.fullName)
					: null,
			});
		}
		for (const repo of repositories) {
			if (
				repo.providerId !== use.providerId ||
				repo.fullName !== use.fullName ||
				(!moved && repo.toJSON().providerRepoId === current.id)
			) {
				continue;
			}
			if (
				moved &&
				// oxlint-disable-next-line no-await-in-loop -- one check per watched repository
				(await RepositoryDTO.getByPath(use.providerId, current.fullName))
			) {
				logger.warn(
					`${use.fullName} moved to ${current.fullName}, which is already watched: repository=${repo.id} left as it is`,
				);
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- one update per watched repository
			await repo.update({
				fullName: current.fullName,
				providerRepoId: current.id,
				webUrl: renameRepoInUrl(repo.webUrl, use.fullName, current.fullName),
			});
		}
		if (moved) {
			logger.info(
				`Repository moved: ${use.fullName} → ${current.fullName} provider=${use.providerId}`,
			);
		}
	}
}

export const GitRepoReconcileService = new GitRepoReconcileServiceClass();
