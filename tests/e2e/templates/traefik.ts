import {
	docker,
	dockerQuiet,
	TRAEFIK_CONTAINER,
	TRAEFIK_PORT,
} from "./support";

/**
 * Starts a throwaway Traefik on the shared `homerun` network, reading the
 * same Docker labels a real install's Traefik does, so each deployed
 * template's route can be checked end to end. Replaces a container left by a
 * crashed run, and returns the teardown that removes it.
 */
export default async function startTraefik(): Promise<() => Promise<void>> {
	await dockerQuiet(["rm", "-f", TRAEFIK_CONTAINER]);
	await dockerQuiet(["network", "create", "homerun"]);
	await docker(
		[
			"run",
			"-d",
			"--name",
			TRAEFIK_CONTAINER,
			"--network",
			"homerun",
			"-p",
			`${TRAEFIK_PORT}:443`,
			"-v",
			"/var/run/docker.sock:/var/run/docker.sock:ro",
			"traefik:v3",
			"--providers.docker=true",
			"--providers.docker.exposedbydefault=false",
			"--providers.docker.network=homerun",
			"--entrypoints.web.address=:80",
			"--entrypoints.websecure.address=:443",
		],
		300_000,
	);
	return async () => {
		await dockerQuiet(["rm", "-f", TRAEFIK_CONTAINER]);
	};
}
