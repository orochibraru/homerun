#!/usr/bin/env bun
import { stat } from "node:fs/promises";
import process from "node:process";

interface ReleaseAsset {
	label: string;
	path: string;
}

interface UploadedAsset {
	name: string;
	size: number;
	state: string;
}

const ASSETS: ReleaseAsset[] = [
	{ label: "homerun-agent (linux/amd64)", path: "dist/homerun-agent-amd64" },
	{ label: "homerun-agent (linux/arm64)", path: "dist/homerun-agent-arm64" },
	{
		label: "homerun-install (linux/amd64)",
		path: "dist/homerun-installer-amd64",
	},
	{
		label: "homerun-install (linux/arm64)",
		path: "dist/homerun-installer-arm64",
	},
	{ label: "homerun CLI (linux/amd64)", path: "dist/homerun-cli-amd64" },
	{ label: "homerun CLI (linux/arm64)", path: "dist/homerun-cli-arm64" },
	{
		label: "homerun CLI (darwin/amd64)",
		path: "dist/homerun-cli-darwin-amd64",
	},
	{
		label: "homerun CLI (darwin/arm64)",
		path: "dist/homerun-cli-darwin-arm64",
	},
];

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 15_000;

/** Runs `gh` with `args`, returning stdout, and throws with stderr when it exits non-zero. */
async function gh(args: string[]): Promise<string> {
	const proc = Bun.spawn(["gh", ...args], { stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(`gh ${args[0]} ${args[1]} failed: ${stderr.trim()}`);
	}
	return stdout;
}

/** The release's assets that finished uploading, by file name. */
async function uploadedAssets(
	tag: string,
): Promise<Map<string, UploadedAsset>> {
	const body = JSON.parse(
		await gh(["release", "view", tag, "--json", "assets"]),
	) as { assets: UploadedAsset[] };
	return new Map(
		body.assets
			.filter((asset) => asset.state === "uploaded")
			.map((asset) => [asset.name, asset]),
	);
}

/** Gzips a binary next to itself, since a compiled Bun binary is ~82 MB raw and ~26 MB gzipped, and returns the compressed path. */
async function compress(path: string): Promise<string> {
	const target = `${path}.gz`;
	await Bun.write(target, Bun.gzipSync(await Bun.file(path).bytes()));
	return target;
}

/** Uploads one asset, replacing a partial one, retrying with a growing delay since GitHub's upload endpoint times out on large files now and then. */
async function upload(tag: string, path: string, label: string): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		try {
			await gh(["release", "upload", tag, `${path}#${label}`, "--clobber"]);
			console.log(`Uploaded ${path}`);
			return;
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS) {
				throw error;
			}
			const delay = RETRY_BASE_MS * attempt;
			console.warn(
				`Upload of ${path} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay / 1000}s: ${error instanceof Error ? error.message : error}`,
			);
			await Bun.sleep(delay);
		}
	}
}

const tag = process.argv[2];
if (!tag) {
	console.error("Usage: bun scripts/upload-release-assets.ts <tag>");
	process.exit(1);
}

const done = await uploadedAssets(tag);
await Promise.all(
	ASSETS.map(async (asset) => {
		const path = await compress(asset.path);
		const name = path.split("/").at(-1) ?? path;
		const { size } = await stat(path);
		if (done.get(name)?.size === size) {
			console.log(`Already uploaded ${path}`);
			return;
		}
		await upload(tag, path, asset.label);
	}),
);

await gh(["release", "edit", tag, "--draft=false", "--latest"]);
console.log(`Published ${tag}`);
