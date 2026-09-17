import type { StepRunner } from "../exec";

class NetworkSetupService {
	/**
	 * Creates the shared network on the daemon behind `dockerSocket`, same
	 * name convention as the main app's homerun. Idempotent: docker network
	 * create errors on a duplicate name, so it checks first.
	 *
	 * @param username The rootless user whose daemon this is, or null for the system daemon, which root reaches directly.
	 */
	async ensureHomerunNetwork(
		run: StepRunner,
		username: string | null,
		dockerSocket: string,
	): Promise<void> {
		const target: { as?: string; env: Record<string, string> } = username
			? {
					as: username,
					env: {
						DOCKER_HOST: `unix://${dockerSocket}`,
						HOME: `/home/${username}`,
					},
				}
			: { env: { DOCKER_HOST: `unix://${dockerSocket}` } };
		const inspected = await run
			.run(["docker", "network", "inspect", "homerun"], target)
			.then(
				() => true,
				() => false,
			);
		if (inspected) {
			console.log("homerun already exists, skipping.");
			return;
		}
		await run.run(["docker", "network", "create", "homerun"], target);
	}
}

export const NetworkSetup = new NetworkSetupService();
