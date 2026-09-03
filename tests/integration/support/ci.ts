/**
 * CI mode : this repo's own `.github/workflows/code_quality.yaml` sets
 * `CI: true` as a job-wide env var (Gitea Actions, same convention GitHub
 * Actions uses). Used for two things, both born from a real CI failure
 * this replaced (the throwaway Postgres container never became ready
 * within the local-dev-tuned 30s timeout on a cold CI runner, which then
 * cascaded into every other integration test failing with a generic
 * "context not initialized" message that gave no hint the real problem was
 * one container's readiness wait) :
 *
 * - Longer timeouts (`ciTimeout`) : a cold CI runner pays real wall-clock
 *   time for a first-time `docker pull`, which a warm local Docker cache
 *   never does.
 * - Real diagnostics on failure (`dumpDockerDiagnostics`) : `docker ps -a`
 *   + `docker logs` for the container in question, printed to stdout
 *   before the error propagates, so a CI log actually shows *why* a
 *   container didn't come up instead of just "never became ready".
 */
import process from "node:process";
export const IS_CI = process.env.CI === "true" || process.env.CI === "1";

/** Picks a longer timeout under CI (cold runners, first-time image pulls, shared/slower hosts) without slowing down the fast local-dev feedback loop. */
export function ciTimeout(localMs: number, ciMs: number): number {
	return IS_CI ? ciMs : localMs;
}

/** A single line, always printed (not gated on IS_CI) : cheap, and useful for local debugging too, but named for what it's *for*. */
export function stepLog(_message: string): void {}

let cachedOwnNetwork: string | null | undefined;

/**
 * Real, CI-observed finding : this repo's own CI runner (self-hosted Gitea
 * Actions, `dind`-labeled) runs each job's steps *inside a container*
 * (`docker exec` into a per-job "runner" container), and a plain
 * `docker run` issued from inside that container — like
 * `startPostgresContainer` below — lands its new container as a *sibling*
 * on the shared Docker daemon, not nested inside the job container. `-p
 * 127.0.0.1:<port>:5432` publishes the port on the daemon's host, which is
 * NOT the job container's own loopback : verified live, the postgres
 * container's own logs showed it fully ready within seconds while the test
 * process spent a full 60s failing to connect to that "published" port.
 * Detected via `/.dockerenv` (the standard marker Docker itself writes into
 * every container) : sibling containers we create should join *our own*
 * container's network and be addressed by container name (Docker's
 * embedded DNS resolves names on a shared user-defined network, unlike the
 * default `bridge` network) instead of relying on host-port publishing.
 * Returns `null` when not running in a container, or when running in one
 * but its own network couldn't be determined (falls back to the
 * host-port-publish behavior either way).
 */
export async function ownDockerNetwork(): Promise<string | null> {
	if (cachedOwnNetwork !== undefined) {
		return cachedOwnNetwork;
	}
	const inContainer = await Bun.file("/.dockerenv").exists();
	if (!inContainer) {
		cachedOwnNetwork = null;
		return null;
	}
	const inspect = Bun.spawnSync(
		[
			"docker",
			"inspect",
			"-f",
			"{{range $k, $v := .NetworkSettings.Networks}}{{$k}}\n{{end}}",
			Bun.env.HOSTNAME ?? "",
		],
		{ stderr: "ignore", stdout: "pipe" },
	);
	const names = new TextDecoder()
		.decode(inspect.stdout)
		.split("\n")
		.map((n) => n.trim())
		.filter(Boolean);
	// The default "bridge" network doesn't support container-name DNS
	// resolution (only user-defined networks do) : prefer any other network
	// this container is also on, if one exists.
	const chosen = names.find((n) => n !== "bridge") ?? names[0] ?? null;
	cachedOwnNetwork = chosen;
	return chosen;
}

/**
 * Best-effort : `docker ps -a` (every container's state) plus `docker logs`
 * for the specific container that failed, if given. Never throws itself —
 * this runs from inside an already-failing path, a diagnostics command
 * itself failing shouldn't mask the real error.
 */
export async function dumpDockerDiagnostics(
	containerName?: string,
): Promise<void> {
	const ps = Bun.spawnSync(["docker", "ps", "-a"], {
		stderr: "pipe",
		stdout: "pipe",
	});
	if (ps.stderr.length > 0) {
	}
	if (containerName) {
		const _logs = Bun.spawnSync(["docker", "logs", containerName], {
			stderr: "pipe",
			stdout: "pipe",
		});
	}
}
