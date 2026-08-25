import { SQL } from "bun";
import {
	ciTimeout,
	dumpDockerDiagnostics,
	ownDockerNetwork,
	stepLog,
} from "./ci";
import { getFreePort } from "./port";

export interface PgContainer {
	containerName: string;
	databaseUrl: string;
	stop: () => Promise<void>;
}

/**
 * A genuinely fresh, throwaway `postgres:18-alpine` container, `POSTGRES_DB`
 * set straight to `homerun_test` : no shared dev Postgres, no
 * drop-and-recreate dance against a maintenance connection (this replaced
 * the previous `db.ts`'s `DROP DATABASE`/`CREATE DATABASE` approach against
 * a fixed-port instance). Torn down (`docker stop`, `--rm` reaps it) in the
 * caller's own teardown.
 *
 * Real, CI-observed finding : `docker run` pulls the image inline if it's
 * missing, and that pull time used to count against the readiness-wait
 * budget below, silently — on a cold CI runner (no local image cache) that
 * ate the whole 30s timeout by itself, surfacing as an opaque "Postgres
 * never became ready" with nothing about *why*. Pulling explicitly first,
 * with its own separately-timed step and real output, makes a slow pull
 * visible instead of indistinguishable from a broken container.
 *
 * Real, CI-observed finding, the actual cause of a *second* round of this
 * same symptom after the pull fix above : on this repo's own CI runner, the
 * test process itself runs inside a container (a per-job "runner"
 * container), and this container is created as a *sibling* of it on the
 * shared Docker daemon, not nested inside it — `-p 127.0.0.1:<port>:5432`
 * publishes the port on the daemon's host, not the job container's own
 * loopback, so connecting via `127.0.0.1` from inside the job container
 * never worked, confirmed live (Postgres's own logs showed it fully ready
 * within seconds while every connection attempt still failed for the full
 * 60s timeout). See ci.ts's `ownDockerNetwork()` : when running inside a
 * container, this container joins *that same* Docker network instead and
 * gets addressed by container name (Docker's embedded DNS resolves names
 * on a shared user-defined network) rather than a published host port. Only
 * relevant to *this* file, agent/socat/the app itself are plain OS
 * processes in the same container as the test code, not separate Docker
 * containers, so 127.0.0.1 already works for those.
 */
export async function startPostgresContainer(): Promise<PgContainer> {
	stepLog("Pulling postgres:18-alpine...");
	const pull = Bun.spawnSync(["docker", "pull", "postgres:18-alpine"], {
		stderr: "inherit",
		stdout: "inherit",
	});
	if (!pull.success) {
		throw new Error(
			`docker pull postgres:18-alpine failed (exit code ${pull.exitCode})`,
		);
	}

	const network = await ownDockerNetwork();
	const name = `homerun-it-pg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

	let databaseUrl: string;
	const args = ["docker", "run", "--rm", "--name", name];
	if (network) {
		stepLog(
			`Starting Postgres container ${name} on this job's own Docker network (${network})...`,
		);
		args.push("--network", network);
		databaseUrl = `postgres://homerun:homerun@${name}:5432/homerun_test`;
	} else {
		const port = getFreePort();
		stepLog(`Starting Postgres container ${name} on port ${port}...`);
		args.push("-p", `127.0.0.1:${port}:5432`);
		databaseUrl = `postgres://homerun:homerun@127.0.0.1:${port}/homerun_test`;
	}
	args.push(
		"-e",
		"POSTGRES_USER=homerun",
		"-e",
		"POSTGRES_PASSWORD=homerun",
		"-e",
		"POSTGRES_DB=homerun_test",
		"postgres:18-alpine",
	);

	const proc = Bun.spawn(args, { stderr: "ignore", stdout: "ignore" });

	const stop = async () => {
		Bun.spawnSync(["docker", "stop", "-t", "5", name], {
			stderr: "ignore",
			stdout: "ignore",
		});
	};

	try {
		await waitForPostgres(databaseUrl, proc, name);
	} catch (err) {
		await dumpDockerDiagnostics(name);
		await stop();
		throw err;
	}

	return { containerName: name, databaseUrl, stop };
}

async function waitForPostgres(
	databaseUrl: string,
	proc: ReturnType<typeof Bun.spawn>,
	containerName: string,
	// The image is already pulled by the time this runs (see above), so
	// this is purely "how long does postgres itself take to accept
	// connections" — still given extra headroom under CI for a generally
	// slower/shared host.
	timeoutMs = ciTimeout(30_000, 60_000),
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (proc.exitCode !== null) {
			throw new Error(
				`postgres container '${containerName}' exited early (code ${proc.exitCode}) before becoming ready`,
			);
		}
		const sql = new SQL(databaseUrl);
		try {
			await sql`select 1`;
			await sql.close();
			return;
		} catch {
			await sql.close().catch(() => {});
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	throw new Error(
		`Postgres container '${containerName}' never became ready within ${timeoutMs}ms`,
	);
}
