import type { StepRunner } from "../exec";

class NetworkSetupService {
	/** Creates the shared network on the rootless daemon : same name convention as the main app's homerun, idempotent (docker network create errors on a duplicate name, so check first). */
	async ensureHomerunNetwork(
		run: StepRunner,
		username: string,
		dockerSocket: string,
	): Promise<void> {
		const env = {
			DOCKER_HOST: `unix://${dockerSocket}`,
			HOME: `/home/${username}`,
		};
		const inspected = await run
			.run(["docker", "network", "inspect", "homerun"], {
				as: username,
				env,
			})
			.then(
				() => true,
				() => false,
			);
		if (inspected) {
			return;
		}
		await run.run(["docker", "network", "create", "homerun"], {
			as: username,
			env,
		});
	}
}

export const NetworkSetup = new NetworkSetupService();
