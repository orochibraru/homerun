import { parseDotEnv } from "$lib/env-parse";
import { DockerService } from "../docker.service.ts";

const HELPER_IMAGE = "alpine";
const HELPER_TAG = "3";
const HOST_ROOT = "/homerun-host";

/**
 * Reads a service's env files from this host and merges them in order, a
 * later file overriding an earlier one, the same precedence compose gives
 * `env_file:`. Each file is read through a throwaway helper container with
 * the host root mounted read-only, since this app usually runs in a
 * container of its own and can't see host paths directly (and a plain bind
 * of a missing path would make Docker create it as a directory).
 *
 * @throws When a file can't be read, which fails the deploy the way a
 * missing required `env_file` fails `docker compose up`.
 */
export async function readHostEnvFiles(
	paths: string[],
	onLog: (line: string) => void,
): Promise<Record<string, string>> {
	const merged: Record<string, string> = {};
	for (const path of paths) {
		onLog(`Reading env file ${path}...`);
		// biome-ignore lint/performance/noAwaitInLoops: files merge in order, a later one overriding an earlier one
		const result = await DockerService.runOneOff({
			binds: [`/:${HOST_ROOT}:ro`],
			cmd: ["cat", `${HOST_ROOT}${path}`],
			image: HELPER_IMAGE,
			tag: HELPER_TAG,
			timeoutMs: 60_000,
		});
		if (result.exitCode !== 0) {
			const detail = result.stderr.toString("utf8").trim();
			throw new Error(
				`Couldn't read the env file ${path} on this host${detail ? `: ${detail}` : "."}`,
			);
		}
		for (const { key, value } of parseDotEnv(result.stdout.toString("utf8"))) {
			merged[key] = value;
		}
	}
	return merged;
}
