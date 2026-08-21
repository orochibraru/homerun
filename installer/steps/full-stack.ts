import type { StepRunner } from "../exec";

/** --mode=full: brings up the actual Homerun app (Traefik + Postgres + the app itself) via the repo's own compose.yaml, under the same rootless user/daemon as everything else this installer sets up. */
export async function bringUpFullStack(
	run: StepRunner,
	username: string,
	repoDir: string,
	dockerSocket: string,
): Promise<void> {
	const env = {
		DOCKER_HOST: `unix://${dockerSocket}`,
		HOME: `/home/${username}`,
	};
	await run.run(["docker", "compose", "up", "-d"], {
		as: username,
		cwd: repoDir,
		env,
	});
}
