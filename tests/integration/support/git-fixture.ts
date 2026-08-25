import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A throwaway local git repo with a trivial Dockerfile, for the git-build
 * deploy scenario : `git clone file:///...` works exactly like a real
 * `https://` clone (git doesn't care about the transport), so this avoids
 * the git-build scenario depending on network access to some external repo
 * staying available forever. Built fresh under a scratch tmpdir (not
 * nested inside this repo's own working tree, to avoid a nested-.git
 * headache), one `git init` + one commit, called once from boot.ts.
 */
export async function createGitBuildFixture(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "homerun-integration-git-fixture-"));

	await writeFile(
		join(dir, "Dockerfile"),
		[
			"FROM busybox:latest",
			'CMD ["sh", "-c", "echo hello from git-build; sleep 3600"]',
			"",
		].join("\n"),
	);

	const run = async (args: string[]) => {
		const proc = Bun.spawn(["git", ...args], {
			cwd: dir,
			stderr: "pipe",
			stdout: "pipe",
		});
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(
				`git ${args.join(" ")} failed (${code}): ${await new Response(proc.stderr).text()}`,
			);
		}
	};

	await run(["init", "--initial-branch=main"]);
	await run(["config", "user.email", "integration-tests@homerun.local"]);
	await run(["config", "user.name", "Homerun Integration Tests"]);
	await run(["add", "-A"]);
	await run(["commit", "-m", "git-build fixture"]);

	return `file://${dir}`;
}
