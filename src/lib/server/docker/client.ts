import Docker from "dockerode";
import { config } from "$lib/config";

// HMR-safe singleton, same pattern as $lib/server/db/lib.ts's bun:sqlite
// client — avoids leaking a new Docker connection on every Vite reload.
const globalForDocker = globalThis as unknown as {
	__docker_client?: Docker;
};

export function getDocker(): Docker {
	if (!globalForDocker.__docker_client) {
		globalForDocker.__docker_client = new Docker({
			socketPath: config.docker.socketPath,
		});
	}
	return globalForDocker.__docker_client;
}
