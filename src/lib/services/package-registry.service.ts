import { PackageRegistryDTO } from "#lib/dto/package-registry-dto.js";
import { PackageRegistryTokenDTO } from "#lib/dto/package-registry-token-dto.js";
import { Logger } from "#lib/logger.js";
import {
	PACKAGE_REGISTRY_INFO,
	type PackageRegistryKind,
} from "#lib/package-registries.js";
import { hostnameOwner } from "#lib/server/hostname-owner.js";
import { DOMAIN_RE } from "#lib/service-domains.js";

import { syncCoreHostDns } from "./dns.service.ts";
import { DockerService } from "./docker.service.ts";
import {
	type PackageRegistryDesiredState,
	packageRegistryInternalUrl,
} from "./docker/package-registry-container.ts";

const logger = new Logger("PackageRegistry");

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

/** Everything a package registry's pages need to describe it. */
export interface PackageRegistryStatus {
	enabled: boolean;
	internalUrl: string;
	kind: PackageRegistryKind;
	publicHost: string | null;
	running: boolean;
	tokenCount: number;
	usageUrl: string;
}

/** A newly created token: the only time its secret is ever readable. */
export interface CreatedPackageRegistryToken {
	id: string;
	secret: string;
	username: string;
}

/**
 * The language package registries (npm through Verdaccio, PyPI through
 * pypiserver), run as core containers the way the Docker registry is.
 *
 * Auth is always on and always htpasswd, which both images read natively and
 * reload on change: a token is a username plus a bcrypt hash Homerun writes
 * into the registry's htpasswd file, and every token can install and publish.
 * There's no anonymous mode, so publishing a registry at a hostname never
 * exposes an open one.
 */
class PackageRegistryServiceClass {
	/** A registry's current state, for its pages' header, Overview and Settings tabs. */
	async status(kind: PackageRegistryKind): Promise<PackageRegistryStatus> {
		const settings = await PackageRegistryDTO.get(kind);
		const enabled = settings?.enabled === true;
		const publicHost = settings?.publicHost ?? null;
		const internalUrl = packageRegistryInternalUrl(kind);
		return {
			enabled,
			internalUrl,
			kind,
			publicHost,
			running: enabled
				? await DockerService.packageRegistryRunning(kind).catch(() => false)
				: false,
			tokenCount: (await PackageRegistryTokenDTO.list(kind)).length,
			usageUrl: publicHost ? `https://${publicHost}/` : internalUrl,
		};
	}

	/** Why a username can't be a token's, or null when it can. */
	validateUsername(username: string): string | null {
		return USERNAME_RE.test(username)
			? null
			: "A username is 3 to 32 characters, lowercase letters, digits, dashes or underscores, starting with a letter or digit.";
	}

	/** Every token of a registry, newest first. Secrets aren't stored, so only the usernames come back. */
	async listTokens(
		kind: PackageRegistryKind,
	): Promise<PackageRegistryTokenDTO[]> {
		return await PackageRegistryTokenDTO.list(kind);
	}

	/**
	 * Creates a token and, when the registry is on, rewrites its htpasswd
	 * file, deleting the token again if that fails.
	 *
	 * @returns The token's id, its username and the generated secret, which is readable this once and never again.
	 * @throws When the username is invalid or already taken, or the rewrite fails.
	 */
	async createToken(
		kind: PackageRegistryKind,
		username: string,
		userId: string,
	): Promise<CreatedPackageRegistryToken> {
		const invalid = this.validateUsername(username);
		if (invalid) {
			throw new Error(invalid);
		}
		if (await PackageRegistryTokenDTO.usernameTaken(kind, username)) {
			throw new Error(`"${username}" already has a token.`);
		}
		const secret = Buffer.from(
			crypto.getRandomValues(new Uint8Array(32)),
		).toString("base64url");
		const token = await PackageRegistryTokenDTO.create({
			kind,
			secretHash: await Bun.password.hash(secret, {
				algorithm: "bcrypt",
				cost: 10,
			}),
			userId,
			username,
		});
		await this.#apply(kind).catch(async (error: unknown) => {
			await token.delete();
			throw error;
		});
		logger.info(
			`${PACKAGE_REGISTRY_INFO[kind].label} token created: ${username}`,
		);
		return { id: token.toJSON().id, secret, username };
	}

	/**
	 * Deletes a token and, when the registry is on, rewrites its htpasswd
	 * file, which is what actually revokes it.
	 *
	 * @throws When the token doesn't exist.
	 */
	async revokeToken(kind: PackageRegistryKind, id: string): Promise<void> {
		const token = await PackageRegistryTokenDTO.get(kind, id);
		if (!token) {
			throw new Error("That token no longer exists.");
		}
		await token.delete();
		await this.#apply(kind);
		logger.info(
			`${PACKAGE_REGISTRY_INFO[kind].label} token revoked: ${token.username}`,
		);
	}

	/** Why a registry can't be published at `host`, or null, checked before the change is queued. */
	async publicHostProblem(
		kind: PackageRegistryKind,
		host: string,
	): Promise<string | null> {
		const trimmed = host.trim().toLowerCase();
		if (!trimmed) {
			return null;
		}
		if (!DOMAIN_RE.test(trimmed)) {
			return "That isn't a hostname, e.g. npm.example.com.";
		}
		const current = await PackageRegistryDTO.get(kind);
		if (current?.publicHost === trimmed) {
			return null;
		}
		const owner = await hostnameOwner(trimmed);
		return owner ? `${trimmed} is already used by ${owner}.` : null;
	}

	/**
	 * Turns a registry on or off and publishes it at `host` (or unpublishes it
	 * when `host` is empty), then brings its container and DNS in line. Off
	 * removes the container and keeps its volumes.
	 *
	 * @throws When the host is invalid or taken, or the container can't be brought up.
	 */
	async configure(
		kind: PackageRegistryKind,
		enabled: boolean,
		host: string,
	): Promise<void> {
		const problem = await this.publicHostProblem(kind, host);
		if (problem) {
			throw new Error(problem);
		}
		const previous = await PackageRegistryDTO.get(kind);
		const previousHost = previous?.enabled ? previous.publicHost : null;
		const saved = await PackageRegistryDTO.save(kind, {
			enabled,
			publicHost: host.trim().toLowerCase() || null,
		});
		await this.#apply(kind);
		void syncCoreHostDns(
			PACKAGE_REGISTRY_INFO[kind].title,
			previousHost,
			saved.enabled ? saved.publicHost : null,
		);
	}

	/** Brings every enabled registry back after a worker restart, the way the Docker registry is re-asserted. */
	async reassert(): Promise<void> {
		for (const settings of await PackageRegistryDTO.list()) {
			if (!settings.enabled) {
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- one registry at a time, each reconcile runs one-off containers
			await this.#apply(settings.kind);
			if (settings.publicHost) {
				void syncCoreHostDns(
					PACKAGE_REGISTRY_INFO[settings.kind].title,
					null,
					settings.publicHost,
				);
			}
		}
	}

	/** Reconciles a registry's container with its stored settings and tokens; removes it when it's off. */
	async #apply(kind: PackageRegistryKind): Promise<void> {
		await DockerService.reconcilePackageRegistry(
			kind,
			await this.#desiredState(kind),
		);
	}

	/** What the registry's container should look like now, or null when it's off. */
	async #desiredState(
		kind: PackageRegistryKind,
	): Promise<PackageRegistryDesiredState | null> {
		const settings = await PackageRegistryDTO.get(kind);
		if (!settings?.enabled) {
			return null;
		}
		const tokens = await PackageRegistryTokenDTO.list(kind);
		return {
			htpasswd: tokens
				.map((token) => `${token.username}:${token.secretHash}`)
				.join("\n"),
			publicHost: settings.publicHost,
		};
	}
}

export const PackageRegistryService = new PackageRegistryServiceClass();
