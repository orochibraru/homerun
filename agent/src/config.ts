/**
 * Env config for the standalone agent. Deliberately tiny and dependency-free
 * (no zod, unlike the main app's config.ts) — this binary has no build step
 * that could catch a bad env var ahead of time, so it just reads with sane
 * defaults and lets `index.ts`'s boot banner make the effective values
 * obvious to whoever's running it.
 */
export const config = {
	/** Same network name convention as the main app's `homerun-network` — not the same network (different host), just the same name so both sides' docs/mental model line up. */
	dockerNetworkName: process.env.HOMERUN_NETWORK_NAME ?? "homerun-network",
	/** Docker's own default; overridden for e.g. a rootless-Docker install (see installer/). */
	dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock",
	/** Explicit token always wins over the persisted/generated one. */
	explicitToken: process.env.AGENT_TOKEN ?? null,
	port: Number.parseInt(process.env.PORT ?? "7420", 10),
	/** Where the agent persists a generated token across restarts when AGENT_TOKEN isn't set explicitly. */
	tokenFile:
		process.env.AGENT_TOKEN_FILE ?? `${homeDir()}/.homerun-agent/token`,
};

function homeDir(): string {
	return process.env.HOME ?? process.env.USERPROFILE ?? "/root";
}
