/**
 * Every shell-out in this installer goes through here : same "shell out to a
 * well-known CLI" precedent the main app uses for git/tar/df/nvidia-smi, just
 * centralized so --dry-run has exactly one place to intercept.
 */
export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

export class StepRunner {
	constructor(private readonly dryRun: boolean) {}

	/** Runs `cmd` and throws on a non-zero exit : the default for steps where "continue anyway" would leave the system in a half-configured state. */
	async run(
		cmd: string[],
		opts?: { as?: string; cwd?: string; env?: Record<string, string> },
	): Promise<ExecResult> {
		// `sudo` resets the environment by default (env_reset) : passing env
		// vars via Bun.spawn's own `env` option wouldn't survive that, so when
		// running `as` another user they're threaded through an explicit `env
		// K=V ...` prefix inside the sudo'd command instead.
		const envPrefix = opts?.env
			? ["env", ...Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)]
			: [];
		const full = opts?.as
			? ["sudo", "-u", opts.as, "--", ...envPrefix, ...cmd]
			: cmd;
		this.log(full, opts);
		if (this.dryRun) {
			return { code: 0, stderr: "", stdout: "" };
		}
		const proc = Bun.spawn(full, {
			cwd: opts?.cwd,
			env: { ...process.env, ...opts?.env },
			stderr: "pipe",
			stdout: "pipe",
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		if (stdout.trim()) {
			process.stdout.write(stdout);
		}
		if (stderr.trim()) {
			process.stderr.write(stderr);
		}
		if (code !== 0) {
			throw new Error(`command failed (${code}): ${full.join(" ")}`);
		}
		return { code, stderr, stdout };
	}

	/** Like `run`, but a non-zero exit is reported and swallowed rather than thrown : for idempotency checks ("does this user already exist?") where failure just means "not yet, keep going". */
	async runOk(
		cmd: string[],
		opts?: { as?: string; cwd?: string },
	): Promise<boolean> {
		try {
			await this.run(cmd, opts);
			return true;
		} catch {
			return false;
		}
	}

	/** Writes a file's content directly (systemd units, etc.) : a no-op under --dry-run, just logged like everything else. */
	async writeFile(path: string, content: string): Promise<void> {
		console.log(
			`${this.dryRun ? "[dry-run]" : "[write]"} ${path} (${content.length} bytes)`,
		);
		if (this.dryRun) {
			return;
		}
		await Bun.write(path, content);
	}

	private log(cmd: string[], opts?: { cwd?: string }): void {
		const prefix = this.dryRun ? "[dry-run]" : "[run]";
		const cwd = opts?.cwd ? ` (cwd=${opts.cwd})` : "";
		console.log(`${prefix} ${cmd.join(" ")}${cwd}`);
	}
}

export async function commandExists(cmd: string): Promise<boolean> {
	const proc = Bun.spawn(["which", cmd], {
		stderr: "ignore",
		stdout: "ignore",
	});
	return (await proc.exited) === 0;
}
