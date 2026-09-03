import { existsSync } from "node:fs";
import { homedir } from "node:os";
import process from "node:process";

/**
 * Env config for the standalone agent. Deliberately tiny and dependency-free
 * (no zod, unlike the main app's config.ts) : this binary has no build step
 * that could catch a bad env var ahead of time, so it just reads with sane
 * defaults and lets `index.ts`'s boot banner make the effective values
 * obvious to whoever's running it.
 */
class AgentConfig {
	/** Same network name convention as the main app's `homerun` : not the same network (different host), just the same name so both sides' docs/mental model line up. */
	dockerNetworkName = process.env.HOMERUN_NETWORK_NAME ?? "homerun";
	/** Only falls back to auto-detection when DOCKER_SOCKET_PATH is unset : see detectDockerSocketPath's docstring. */
	dockerSocketPath =
		process.env.DOCKER_SOCKET_PATH ?? AgentConfig.detectDockerSocketPath();
	/** Explicit token always wins over the persisted/generated one. */
	explicitToken = process.env.AGENT_TOKEN ?? null;
	port = Number.parseInt(process.env.PORT ?? "7420", 10);
	/**
	 * Max seconds to wait, on SIGINT/SIGTERM, for in-flight requests to
	 * finish before forcing the shutdown : deliberately generous compared to
	 * the main app's own default (see the adapter's SHUTDOWN_TIMEOUT), since
	 * a request here can be a real long-running `/v1/deploy` (image pull) or
	 * `/v1/build` (git clone + docker build), not just an ordinary
	 * request/response, killing one mid-way can leave a container half
	 * created or a build silently truncated.
	 */
	shutdownTimeoutSeconds = Number.parseInt(
		process.env.AGENT_SHUTDOWN_TIMEOUT ?? "120",
		10,
	);
	/** Where the agent persists a generated token across restarts when AGENT_TOKEN isn't set explicitly. */
	tokenFile =
		process.env.AGENT_TOKEN_FILE ??
		`${AgentConfig.homeDir()}/.homerun-agent/token`;

	private static homeDir(): string {
		return process.env.HOME ?? process.env.USERPROFILE ?? "/root";
	}

	/**
	 * Same detection order as the main app's parallel copy
	 * (src/lib/config.ts's detectDockerSocketPath, kept in sync by hand, no
	 * shared runtime between the two) : DOCKER_HOST if set, then the
	 * `docker` CLI's own currently-active context (the actual "default
	 * docker context" the CLI itself would connect to, covers OrbStack/
	 * Docker Desktop/Colima/a custom context automatically), then a
	 * handful of common non-default socket locations (for the case
	 * `docker` isn't installed, e.g. a minimal container with only the
	 * socket bind-mounted in, see tools/compose/agent.compose.yaml), then
	 * the original hardcoded default as the final fallback.
	 */
	private static detectDockerSocketPath(): string {
		const dockerHost = process.env.DOCKER_HOST;
		if (dockerHost?.startsWith("unix://")) {
			return dockerHost.slice("unix://".length);
		}

		try {
			const result = Bun.spawnSync([
				"docker",
				"context",
				"inspect",
				"--format",
				"{{.Endpoints.docker.Host}}",
			]);
			if (result.exitCode === 0) {
				const host = result.stdout.toString().trim();
				if (host.startsWith("unix://")) {
					return host.slice("unix://".length);
				}
			}
		} catch {
			// `docker` isn't installed/on PATH : fall through to path probing.
		}

		const candidates = [
			"/var/run/docker.sock",
			`${homedir()}/.orbstack/run/docker.sock`,
			`${homedir()}/.docker/run/docker.sock`,
			`${homedir()}/.colima/default/docker.sock`,
		];
		for (const candidate of candidates) {
			if (existsSync(candidate)) {
				return candidate;
			}
		}

		return "/var/run/docker.sock";
	}
}

export const config = new AgentConfig();
