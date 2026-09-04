import { readFileSync } from "node:fs";
import process from "node:process";

export class PublishedRelease {
	private constructor(
		readonly tag: string,
		readonly assets: readonly string[],
		readonly repo: string,
	) {}

	static #repoFromBootstrap(): string {
		const source = readFileSync("packages/installer/bootstrap.sh", "utf8");
		const repo = source.match(/^GIT_REPO="([^"]+)"/m)?.[1];
		const host = source.match(/^GIT_HOST="([^"]+)"/m)?.[1];
		if (!repo || host !== "github.com") {
			throw new Error(
				`packages/installer/bootstrap.sh points at ${host}/${repo}, which this suite doesn't know how to query (it speaks the GitHub releases API).`,
			);
		}
		return repo;
	}

	static async resolve(version: string): Promise<PublishedRelease> {
		const repo = PublishedRelease.#repoFromBootstrap();
		const path =
			version === "latest"
				? "releases/latest"
				: `releases/tags/${encodeURIComponent(version)}`;
		const headers: Record<string, string> = {
			accept: "application/vnd.github+json",
		};
		if (process.env.GITHUB_TOKEN) {
			headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		}
		const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
			headers,
		});
		if (!res.ok) {
			throw new Error(
				`GitHub release lookup failed for ${repo} (${version}): ${res.status} ${res.statusText}`,
			);
		}
		const body = (await res.json()) as {
			assets: Array<{ name: string }>;
			tag_name: string;
		};
		return new PublishedRelease(
			body.tag_name,
			body.assets.map((asset) => asset.name),
			repo,
		);
	}

	assertAssets(names: readonly string[]): void {
		const missing = names.filter((name) => !this.assets.includes(name));
		if (missing.length > 0) {
			throw new Error(
				`Release ${this.tag} of ${this.repo} is missing published asset(s): ${missing.join(", ")}. Present: ${this.assets.join(", ")}`,
			);
		}
	}
}
