#!/usr/bin/env bun
/**
 * Builds the Linux x64/arm64 binaries `.releaserc.json`'s
 * `@semantic-release/github` step attaches as release assets. Each
 * sub-project (agent/installer/cli) already has its own `bun run
 * build:linux-x64`/`build:linux-arm64` scripts (see their package.json) —
 * this just runs all six in a row from the repo root, which is what CI
 * needs before the release step runs.
 */

const targets: Array<{ dir: string }> = [
	{ dir: "agent" },
	{ dir: "installer" },
	{ dir: "cli" },
];

for (const { dir } of targets) {
	console.log(`Installing deps for ${dir}...`);
	const install = Bun.spawn(["bun", "install"], {
		cwd: dir,
		stderr: "inherit",
		stdout: "inherit",
	});
	if ((await install.exited) !== 0) {
		console.error(`bun install failed: ${dir}`);
		process.exit(1);
	}

	for (const arch of ["linux-x64", "linux-arm64"]) {
		console.log(`Building ${dir} for ${arch}...`);
		const proc = Bun.spawn(["bun", "run", `build:${arch}`], {
			cwd: dir,
			stderr: "inherit",
			stdout: "inherit",
		});
		const code = await proc.exited;
		if (code !== 0) {
			console.error(`Build failed: ${dir} (${arch})`);
			process.exit(code);
		}
	}
}
