export {};

const CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

const fix = process.argv.includes("--fix");
const files = await Array.fromAsync(
	new Bun.Glob("src/**/*.{svelte,css,html}").scan({ cwd: process.cwd() }),
);
files.sort();

const cssFiles = files.filter((file) => file.endsWith(".css"));
const otherFiles = files.filter((file) => !file.endsWith(".css"));

let exitCode = 0;
for (const batch of chunk(otherFiles, CHUNK_SIZE)) {
	const args = fix ? ["--fix", ...cssFiles, ...batch] : [...cssFiles, ...batch];
	const result = Bun.spawnSync(
		["bun", "run", "node_modules/tailwint/bin/tailwint.js", ...args],
		{ stderr: "inherit", stdout: "inherit" },
	);
	if (!result.success) {
		exitCode = 1;
	}
}

process.exit(exitCode);
