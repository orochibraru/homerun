import process from "node:process";

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

const exitCodes = await Promise.all(
	chunk(otherFiles, CHUNK_SIZE).map((batch) => {
		const args = fix
			? ["--fix", ...cssFiles, ...batch]
			: [...cssFiles, ...batch];
		return Bun.spawn(
			["bun", "run", "node_modules/tailwint/bin/tailwint.js", ...args],
			{ stderr: "inherit", stdout: "inherit" },
		).exited;
	}),
);

process.exit(exitCodes.every((code) => code === 0) ? 0 : 1);
