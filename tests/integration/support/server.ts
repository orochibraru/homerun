import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { ciTimeout } from "./ci";

/** The built app's entry point : `@orochibraru/svelte-smol` compiles a single `build/server` binary, the same one `bun run start` runs. */
export const APP_ENTRY = "./build/server";

/**
 * Fails fast with a clear instruction when the app hasn't been built yet,
 * rather than letting `spawnApp` below time out with a confusing "app never
 * became healthy" message. Building is a separate, explicit operation
 * (`bun run build:app`), neither suite does it for you.
 */
export function assertAppIsBuilt(): void {
	const entry = join(process.cwd(), APP_ENTRY);
	if (!existsSync(entry)) {
		throw new Error(
			`${entry} doesn't exist : run \`bun run build:app\` first, this suite no longer builds the app for you.`,
		);
	}
}

export interface SpawnedApp {
	proc: ReturnType<typeof Bun.spawn>;
	stop: () => Promise<void>;
}

export interface SpawnAppOptions {
	authSecret: string;
	baseDomain: string;
	databaseUrl: string;
	origin: string;
	port: number;
}

export async function spawnApp(options: SpawnAppOptions): Promise<SpawnedApp> {
	const proc = Bun.spawn([APP_ENTRY], {
		cwd: process.cwd(),
		env: {
			...process.env,
			AUTH_SECRET: options.authSecret,
			BASE_DOMAIN: options.baseDomain,
			DATABASE_URL: options.databaseUrl,
			ORIGIN: options.origin,
			PORT: String(options.port),
		},
		stderr: "pipe",
		stdout: "pipe",
	});

	const logLines: string[] = [];
	void (async () => {
		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			logLines.push(decoder.decode(value));
		}
	})();
	void (async () => {
		const reader = proc.stderr.getReader();
		const decoder = new TextDecoder();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			logLines.push(decoder.decode(value));
		}
	})();

	const timeoutMs = ciTimeout(60_000, 120_000);
	const deadline = Date.now() + timeoutMs;
	let healthy = false;
	while (Date.now() < deadline) {
		if (proc.exitCode !== null) {
			throw new Error(
				`App process exited early (code ${proc.exitCode}) before becoming healthy:\n${logLines.join("")}`,
			);
		}
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
		proc.kill();
		throw new Error(
			`App never became healthy within ${timeoutMs}ms:\n${logLines.join("")}`,
		);
	}

	return {
		proc,
		stop: async () => {
			proc.kill("SIGTERM");
			await proc.exited;
		},
	};
}
