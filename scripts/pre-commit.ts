#!/usr/bin/env bun
import { existsSync } from "node:fs";
import process from "node:process";

/**
 * The pre-commit hook body, called by `.husky/pre-commit`.
 *
 * Replaces ~90 lines of POSIX shell that hand-built staged-file lists with
 * `case` statements, heredoc loops and `sed` glob-escaping. Everything here
 * spawns via argv arrays (`Bun.spawnSync`), so there's no shell word
 * splitting, quoting or globbing to get wrong on a path with spaces or a
 * SvelteKit `[param]`/`(group)` route folder.
 *
 * Deliberately not `prek`/`pre-commit`: both stash unstaged changes on a
 * staged run (no opt-out flag exists) and neither re-stages what a hook
 * fixed, so every autofix would abort the commit. This keeps the existing
 * behaviour instead : no stash, autofix, re-stage, commit proceeds.
 */

/** tailwint's own default scan set : mirrored here only to decide whether running it is worthwhile for this commit. */
const TAILWIND_EXTENSIONS =
	/\.(?:tsx|jsx|html|vue|svelte|astro|mdx|css)$/ as const;

/**
 * Runs a command with stdio inherited, returning its exit code.
 *
 * Bun.spawnSync *throws* ENOENT for a binary that isn't on PATH rather
 * than returning a non-zero exitCode, so a missing tool would otherwise
 * abort the hook with a raw stack trace instead of a readable message.
 */
function run(cmd: string[]): number {
	try {
		const proc = Bun.spawnSync(cmd, {
			stderr: "inherit",
			stdout: "inherit",
		});
		return proc.exitCode ?? 1;
	} catch (err) {
		console.error(
			`Couldn't run \`${cmd.join(" ")}\`: ${err instanceof Error ? err.message : String(err)}`,
		);
		return 127;
	}
}

/** Paths staged for this commit, excluding deletions (nothing to format about a file that's gone). */
function stagedFiles(): string[] {
	const proc = Bun.spawnSync(
		["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
		{ stderr: "inherit", stdout: "pipe" },
	);
	return new TextDecoder()
		.decode(proc.stdout)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

console.log("Registering staged files...");
const staged = stagedFiles();
if (staged.length === 0) {
	console.log("No staged files to format");
	process.exit(0);
}

// Regenerating first : the OpenAPI spec and CLI types are derived from
// source that may itself be part of this commit, so they have to be
// up to date before anything formats or lints them.
console.log("Generating openapi spec");
const genExit = run(["bun", "run", "gen"]);
if (genExit !== 0) {
	console.error("Linters found issues that could not be auto-fixed.");
	process.exit(genExit);
}

console.log("Formatting/linting staged files...");

// Biome reads git's staged list itself and still honors biome.json's own
// ignore patterns, so it needs no file list from here.
let failure = run([
	"bunx",
	"biome",
	"check",
	"--write",
	"--unsafe",
	"--staged",
]);

const markdown = staged.filter((file) => file.endsWith(".md"));
if (markdown.length > 0) {
	failure =
		run(["bunx", "prettier", "--log-level", "warn", "--write", ...markdown]) ||
		failure;
	failure = run(["bunx", "markdownlint-cli2", "--fix", ...markdown]) || failure;
}

// Deliberately a whole-repo scan rather than the staged paths: tailwint
// discards explicit file arguments (verified live, every form : single
// path, multiple paths and a glob all report "0/N files received, 0 files
// scanned" and exit in ~0.2s, versus ~3.4s and a real scan with no args),
// so passing staged files made this step silently check nothing at all.
// Only the decision to run it at all is staged-scoped.
if (staged.some((file) => TAILWIND_EXTENSIONS.test(file))) {
	failure = run(["bunx", "tailwint", "--fix"]) || failure;
}

// Re-stage what the fixers just rewrote, so the commit contains the
// formatted content rather than what was originally staged. A path the
// hooks deleted is skipped rather than failing the `git add`.
const surviving = staged.filter((file) => existsSync(file));
if (surviving.length > 0) {
	console.log(`Staging modified changes for ${surviving.length} file(s)`);
	failure = run(["git", "add", "--", ...surviving]) || failure;
}

if (failure !== 0) {
	console.error("Linters found issues that could not be auto-fixed.");
	process.exit(failure);
}

console.log("✨ Staged files formatted/linted");
