import type { StepRunner } from "../exec";

export const SYSTEM_DOCKER_SOCKET = "/var/run/docker.sock";

export const SWARM_NETWORK = "homerun-swarm";

export type SwarmNodeState = "inactive" | "manager" | "worker";

const SYSTEM_DOCKER = {
	env: { DOCKER_HOST: `unix://${SYSTEM_DOCKER_SOCKET}` },
};

/**
 * Reads `docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}'`
 * output: a manager is active with control available, a worker is active
 * without it, anything else (inactive, pending, an empty dry-run) isn't in a
 * swarm yet.
 */
export function swarmNodeState(infoOutput: string): SwarmNodeState {
	const [state, control] = infoOutput.trim().split(/\s+/);
	if (state !== "active") {
		return "inactive";
	}
	return control === "true" ? "manager" : "worker";
}

/** The `docker swarm init` argv, advertising `advertiseAddress` when there is one. */
export function swarmInitCommand(advertiseAddress: string | null): string[] {
	return advertiseAddress
		? ["docker", "swarm", "init", "--advertise-addr", advertiseAddress]
		: ["docker", "swarm", "init"];
}

class SwarmSetupService {
	/**
	 * Makes the system daemon a swarm manager, skipping a host that already is
	 * one. The address is passed explicitly because `docker swarm init` refuses
	 * to guess on a host with several interfaces ("could not choose an IP
	 * address to advertise").
	 *
	 * @param advertiseAddress `--advertise-addr=`, or the detected default-route address.
	 * @throws When the host is a worker in another swarm, or when init fails.
	 */
	async ensureManager(
		run: StepRunner,
		advertiseAddress: string | null,
	): Promise<void> {
		const info = await run.run(
			[
				"docker",
				"info",
				"--format",
				"{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}",
			],
			SYSTEM_DOCKER,
		);
		const state = swarmNodeState(info.stdout);
		if (state === "manager") {
			console.log("This host is already a swarm manager, skipping init.");
			return;
		}
		if (state === "worker") {
			throw new Error(
				"This host is a worker in another swarm : Homerun needs to run on a manager. Run `docker swarm leave` first, or install on the manager.",
			);
		}
		try {
			await run.run(swarmInitCommand(advertiseAddress), SYSTEM_DOCKER);
		} catch (error) {
			throw new Error(
				`docker swarm init failed${advertiseAddress ? ` advertising ${advertiseAddress}` : ""} : re-run with --advertise-addr=<this host's IP>. ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Creates the attachable overlay network swarm services join, named and
	 * shaped the way the app's own `ensureSwarmNetwork` makes it
	 * (`<networkName>-swarm`, overlay, attachable) so Traefik's compose
	 * container can join it too. Idempotent.
	 *
	 * @throws When a network of that name exists but isn't an attachable overlay.
	 */
	async ensureOverlayNetwork(run: StepRunner): Promise<void> {
		const inspected = await run
			.run(
				[
					"docker",
					"network",
					"inspect",
					"--format",
					"{{.Driver}} {{.Attachable}}",
					SWARM_NETWORK,
				],
				SYSTEM_DOCKER,
			)
			.catch(() => null);
		if (inspected) {
			const shape = inspected.stdout.trim();
			if (shape && shape !== "overlay true") {
				throw new Error(
					`A "${SWARM_NETWORK}" network already exists as "${shape}" : remove it (docker network rm ${SWARM_NETWORK}) so it can be recreated as an attachable overlay.`,
				);
			}
			console.log(`${SWARM_NETWORK} already exists, skipping.`);
			return;
		}
		await run.run(
			[
				"docker",
				"network",
				"create",
				"--driver",
				"overlay",
				"--attachable",
				SWARM_NETWORK,
			],
			SYSTEM_DOCKER,
		);
	}
}

export const SwarmSetup = new SwarmSetupService();
