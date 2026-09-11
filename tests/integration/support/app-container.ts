import process from "node:process";
import { ciTimeout } from "./ci";
import type { SpawnAppOptions, SpawnedApp } from "./server";

/**
 * The image under test, set by CI to the exact digest `docker.yaml` pushed
 * (`<registry>/<image>@sha256:<digest>`). Unset locally, where the suite falls
 * back to spawning the `build/server` binary instead, see `spawnAppOrContainer`.
 */
export function imageUnderTest(): string | undefined {
	const image = process.env.E2E_IMAGE?.trim();
	return image ? image : undefined;
}

/**
 * A container can't reach the host's Postgres through `localhost` : that
 * resolves to the container itself. `host.docker.internal` is Docker Desktop's
 * own name for the host and is made to resolve on Linux too by the
 * `--add-host=host.docker.internal:host-gateway` flag below, so one rewrite
 * covers both a GitHub runner and a macOS dev machine.
 */
function databaseUrlForContainer(databaseUrl: string): string {
	const url = new URL(databaseUrl);
	if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
		url.hostname = "host.docker.internal";
	}
	return url.toString();
}

async function dockerRemove(name: string): Promise<void> {
	await Bun.spawn(["docker", "rm", "-f", name], {
		stderr: "ignore",
		stdout: "ignore",
	}).exited;
}

async function containerLogs(name: string): Promise<string> {
	const proc = Bun.spawn(["docker", "logs", name], {
		stderr: "pipe",
		stdout: "pipe",
	});
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return `${out}${err}`;
}

/**
 * Runs the already-built image rather than the locally-compiled binary, so CI
 * exercises the exact artefact it is about to publish instead of a second build
 * of the same source. The health-check loop, timeout and failure reporting
 * mirror `spawnApp`'s deliberately : only the process being started differs.
 */
export async function startAppContainer(
	image: string,
	options: SpawnAppOptions,
): Promise<SpawnedApp> {
	const name = `homerun-e2e-${Date.now().toString(36)}`;
	await dockerRemove(name);

	const proc = Bun.spawn(
		[
			"docker",
			"run",
			"-d",
			"--name",
			name,
			"--add-host",
			"host.docker.internal:host-gateway",
			"-p",
			`${options.port}:${options.port}`,
			"-e",
			`AUTH_SECRET=${options.authSecret}`,
			"-e",
			`BASE_DOMAIN=${options.baseDomain}`,
			"-e",
			`DATABASE_URL=${databaseUrlForContainer(options.databaseUrl)}`,
			"-e",
			`ORIGIN=${options.origin}`,
			"-e",
			`PORT=${String(options.port)}`,
			"-e",
			"HOMERUN_DISABLE_AUTH_RATE_LIMIT=1",
			image,
		],
		{ stderr: "pipe", stdout: "pipe" },
	);
	const startErr = await new Response(proc.stderr).text();
	await proc.exited;
	if (proc.exitCode !== 0) {
		throw new Error(`Could not start ${image}: ${startErr}`);
	}

	const timeoutMs = ciTimeout(60_000, 120_000);
	const deadline = Date.now() + timeoutMs;
	let healthy = false;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${options.origin}/api/health`, {
				signal: AbortSignal.timeout(1000),
			});
			if (res.ok) {
				healthy = true;
				break;
			}
		} catch {
			// Not listening yet, or still migrating : retry.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!healthy) {
		const logs = await containerLogs(name);
		await dockerRemove(name);
		throw new Error(
			`${image} never became healthy within ${timeoutMs}ms:\n${logs}`,
		);
	}

	return {
		proc,
		stop: async () => {
			await dockerRemove(name);
		},
	};
}
