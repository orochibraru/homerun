import { ciTimeout } from "./ci";

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
	const proc = Bun.spawn(["bun", "run", "./build/index.js"], {
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
