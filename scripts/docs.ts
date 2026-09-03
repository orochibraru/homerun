/**
 * Orchestrates `packages/docs/`'s dev/build/check commands (`bun run
 * dev:docs`/`build:docs`/`check:docs`), handling two things every one of
 * them needs first:
 *
 * 1. A stub `.svelte-kit/tsconfig.json` at the *repo root*, not
 *    `packages/docs/`'s own. Real, tested finding: this repo's pinned
 *    rolldown-vite (pre-1.0/beta, see the root package.json's
 *    "vite"/"rolldown" versions) has a built-in TS-transform plugin that,
 *    for files under `packages/docs/`, resolves `tsconfig.json`'s "extends"
 *    chain against the repo root instead of `packages/docs/` itself,
 *    regardless of what `packages/docs/tsconfig.json` actually says
 *    (confirmed live: changing that file's own "extends" value had no
 *    effect on the error, which kept citing the *root* tsconfig's own
 *    extends target). Locally this is invisible the moment `bun run dev`/
 *    `check:app` has ever run once (the root's real `.svelte-kit/
 *    tsconfig.json` already exists by then), which is exactly what made
 *    this look fine in ad-hoc local testing before a clean Docker build
 *    caught it for real. A minimal stub here (only written if the real one
 *    isn't already there, so a real `check:app` run's output is never
 *    clobbered) satisfies the buggy resolver; `packages/docs/`'s own
 *    generated tsconfig (`svelte-kit sync`, below) still drives its real
 *    type-aware tooling. Revisit if a future rolldown-vite upgrade fixes
 *    this upstream.
 * 2. Copying the repo root's own `openapi.json` (checked in, regenerated via
 *    `bun run gen`) into `packages/docs/static/`, so its Swagger UI page
 *    (`src/routes/docs/api/+page.svelte`) has a real spec to serve as a
 *    static asset. Best-effort: a fresh checkout that hasn't run `bun run
 *    gen` yet just won't have a working API reference page until it does,
 *    same "warn, don't block" posture the image-existence checker elsewhere
 *    in this app uses.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "build" && mode !== "check") {
	console.error("Usage: bun run scripts/docs.ts <dev|build|check>");
	process.exit(1);
}

const repoRoot = join(import.meta.dirname, "..");
const docsDir = join(repoRoot, "packages/docs");

const rootSvelteKitTsconfig = join(repoRoot, ".svelte-kit/tsconfig.json");
if (!existsSync(rootSvelteKitTsconfig)) {
	mkdirSync(join(repoRoot, ".svelte-kit"), { recursive: true });
	writeFileSync(rootSvelteKitTsconfig, '{"compilerOptions":{}}');
}

const rootOpenapi = join(repoRoot, "openapi.json");
if (existsSync(rootOpenapi)) {
	copyFileSync(rootOpenapi, join(docsDir, "static/openapi.json"));
} else {
	console.warn(
		"scripts/docs.ts: no openapi.json at the repo root yet (run `bun run gen` first) : the docs site's API reference page will 404 fetching its spec until it exists.",
	);
}

const bin = (name: string) => join(repoRoot, "node_modules/.bin", name);

const commands: Record<typeof mode, string[][]> = {
	build: [
		[bin("svelte-kit"), "sync"],
		[bin("vite"), "build"],
	],
	check: [
		[bin("svelte-kit"), "sync"],
		[
			bin("svelte-check"),
			"--tsconfig",
			"./tsconfig.json",
			"--fail-on-warnings",
		],
	],
	dev: [[bin("vite"), "dev"]],
};

for (const cmd of commands[mode]) {
	const proc = Bun.spawnSync(cmd, {
		cwd: docsDir,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (!proc.success) {
		process.exit(proc.exitCode ?? 1);
	}
}
