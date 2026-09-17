import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { StepRunner } from "../exec";
import { FullStackInstaller } from "./full-stack";
import { NetworkSetup } from "./network";
import { RootlessDockerInstaller } from "./rootless-docker";
import { SwarmSetup, SYSTEM_DOCKER_SOCKET } from "./swarm";

export interface VolumeDefinition {
	Driver: string;
	Labels: Record<string, string> | null;
	Name: string;
	Options: Record<string, string> | null;
}

export interface MigrationParams {
	advertiseAddress: string | null;
	domain?: string;
	dryRun: boolean;
	image?: string;
	/** Falls back to the detected or prompted host when neither `--domain=` nor the existing files say where the instance is reached. */
	resolveHost: () => Promise<string>;
	run: StepRunner;
	username: string;
	version: string;
}

export interface MigrationReport {
	bindMounts: string[];
	composePath: string;
	otherContainers: string[];
	rootlessSocket: string;
	uid: string;
}

interface DockerTarget {
	env: Record<string, string>;
}

const ANONYMOUS_VOLUME = /^[0-9a-f]{64}$/;

const COMPOSE_ORIGIN_HOST = /ORIGIN: \$\{ORIGIN:-https?:\/\/([^:/}]+)/;

const CONFIG_BASE_DOMAIN = /^baseDomain:\s*(\S+)\s*$/m;

const CONFIG_SOCKET_PATH = /^(\s*socketPath:).*$/m;

const LOOPBACK_HOST = /^(localhost|127\.)/;

const SYSTEM_DOCKER: DockerTarget = {
	env: { DOCKER_HOST: `unix://${SYSTEM_DOCKER_SOCKET}` },
};

export const SWITCH_TO_SWARM_SQL =
	"UPDATE instance_settings SET orchestration_mode = 'swarm', pending_service_redeploy = true, docker_socket_path = CASE WHEN docker_socket_path LIKE '/run/user/%' THEN NULL ELSE docker_socket_path END";

/** The volumes worth copying : every named volume, never an anonymous one (64 hex characters), which only ever belonged to a container that won't exist on the new daemon. */
export function copyableVolumes(names: string[]): string[] {
	return names
		.map((name) => name.trim())
		.filter((name) => name && !ANONYMOUS_VOLUME.test(name));
}

/** The host an installer-generated compose file bakes into its ORIGIN default, null when there's none or it's a loopback address. */
export function hostFromCompose(compose: string): string | null {
	const host = compose.match(COMPOSE_ORIGIN_HOST)?.[1] ?? null;
	return host && !LOOPBACK_HOST.test(host) ? host : null;
}

/** homerun.yaml's `baseDomain`, null when unset or loopback. */
export function baseDomainFromConfig(config: string): string | null {
	const host = config.match(CONFIG_BASE_DOMAIN)?.[1] ?? null;
	return host && !LOOPBACK_HOST.test(host) ? host : null;
}

/** homerun.yaml pointed at the system daemon's socket instead of the rootless one. */
export function rootfulConfig(config: string): string {
	return CONFIG_SOCKET_PATH.test(config)
		? config.replace(CONFIG_SOCKET_PATH, `$1 ${SYSTEM_DOCKER_SOCKET}`)
		: config;
}

/** One `KEY=value` from a docker compose `.env` file, null when absent. */
export function envValue(envFile: string, key: string): string | null {
	for (const line of envFile.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith(`${key}=`)) {
			return trimmed.slice(key.length + 1).replace(/^["']|["']$/g, "");
		}
	}
	return null;
}

/** `docker volume create` recreating a volume with its driver, labels and driver options, so compose still recognises the ones it created. */
export function volumeCreateCommand(volume: VolumeDefinition): string[] {
	return [
		"docker",
		"volume",
		"create",
		"--driver",
		volume.Driver || "local",
		...Object.entries(volume.Labels ?? {}).flatMap(([key, value]) => [
			"--label",
			`${key}=${value}`,
		]),
		...Object.entries(volume.Options ?? {}).flatMap(([key, value]) => [
			"--opt",
			`${key}=${value}`,
		]),
		volume.Name,
	];
}

/** Whether a volume's data lives outside Docker's own volume directory (a `local` volume with a `device` option), so there's nothing to copy. */
export function holdsDataElsewhere(volume: VolumeDefinition): boolean {
	return Boolean(volume.Options?.device);
}

/**
 * A bash script streaming one volume's files from the rootless daemon into
 * the same-named volume on the system daemon, through a throwaway alpine
 * container on each side. Ownership is carried numerically as the containers
 * see it, so a file owned by uid 70 inside a rootless container is owned by
 * uid 70 in the rootful volume too, not by the subuid it mapped to on disk.
 */
export function volumeCopyScript(name: string, rootlessSocket: string): string {
	return [
		"set -euo pipefail",
		`docker -H unix://${rootlessSocket} run --rm -v ${name}:/from:ro alpine:3 tar -C /from --numeric-owner -cf - . | docker -H unix://${SYSTEM_DOCKER_SOCKET} run --rm -i -v ${name}:/to alpine:3 tar -C /to --numeric-owner -xf -`,
	].join("\n");
}

class RootfulMigrationService {
	/**
	 * `--migrate-to-rootful`: moves a rootless `--mode=full` install onto the
	 * system daemon in swarm mode. Stops everything on the rootless daemon,
	 * copies every named volume across, makes the system daemon a swarm
	 * manager with the shared and overlay networks, rewrites homerun.yaml and
	 * the compose file (keeping `.env`), starts the stack, switches the
	 * instance to swarm with a redeploy of every service queued, and finally
	 * disables the rootless daemon without deleting its data.
	 *
	 * Re-runnable: finished volume copies and the instance switch are
	 * recorded under `<compose dir>/.rootful-migration`, so a second run only
	 * redoes what didn't finish.
	 *
	 * @throws When there's no `--mode=full` install to migrate, when the
	 *   rootless daemon can't be reached while volumes still need copying, or
	 *   when any command fails.
	 */
	async migrate(params: MigrationParams): Promise<MigrationReport> {
		const { run, username } = params;
		const composeDir = `/home/${username}/homerun`;
		const composePath = `${composeDir}/compose.yaml`;
		const stateDir = `${composeDir}/.rootful-migration`;
		if (!(params.dryRun || existsSync(composePath))) {
			throw new Error(
				`No --mode=full install found at ${composePath} : nothing to migrate.`,
			);
		}
		const uid = (await run.run(["id", "-u", username])).stdout.trim() || "1000";
		const rootlessSocket = `/run/user/${uid}/docker.sock`;
		const rootless: DockerTarget = {
			env: { DOCKER_HOST: `unix://${rootlessSocket}` },
		};
		await run.run(["mkdir", "-p", stateDir]);

		console.log("\n== 1/6 System Docker daemon ==");
		await RootlessDockerInstaller.installDockerEngine(run);
		await RootlessDockerInstaller.enableRootfulDocker(run);
		await RootlessDockerInstaller.addUserToDockerGroup(run, username);

		console.log("\n== 2/6 Stop everything on the rootless daemon ==");
		const volumesFile = `${stateDir}/volumes.json`;
		const pending = await this.#copyPending(volumesFile, stateDir);
		const reachable = await this.#ensureRootlessDaemon(run, {
			pending,
			rootless,
			uid,
			username,
		});
		const inventory = reachable
			? await this.#inventory(run, rootless)
			: { bindMounts: [], otherContainers: [] };
		if (reachable) {
			await this.#stopAll(run, rootless);
		}

		console.log("\n== 3/6 Copy volumes to the system daemon ==");
		await this.#copyVolumes(run, {
			reachable,
			rootless,
			rootlessSocket,
			stateDir,
			volumesFile,
		});

		console.log("\n== 4/6 Swarm manager and networks ==");
		await NetworkSetup.ensureHomerunNetwork(run, null, SYSTEM_DOCKER_SOCKET);
		await SwarmSetup.ensureManager(run, params.advertiseAddress);
		await SwarmSetup.ensureOverlayNetwork(run);

		console.log("\n== 5/6 Start the stack on the system daemon ==");
		const host = await this.#host(params, composeDir);
		await this.#rewriteConfig(run, composeDir);
		await FullStackInstaller.bringUpFullStack({
			dockerSocket: SYSTEM_DOCKER_SOCKET,
			host,
			image: params.image,
			rootful: true,
			run,
			swarm: true,
			username,
			version: params.version,
		});

		console.log("\n== 6/6 Switch the instance to swarm mode ==");
		await this.#switchInstance(run, composeDir, stateDir);
		await this.#disableRootlessDaemon(run, username, uid);

		return {
			bindMounts: inventory.bindMounts,
			composePath,
			otherContainers: inventory.otherContainers,
			rootlessSocket,
			uid,
		};
	}

	/** Whether any volume still needs copying : true until the volume list has been recorded and every one of them has its done marker. */
	async #copyPending(volumesFile: string, stateDir: string): Promise<boolean> {
		if (!existsSync(volumesFile)) {
			return true;
		}
		const volumes = JSON.parse(
			await readFile(volumesFile, "utf8"),
		) as VolumeDefinition[];
		return volumes.some(
			(volume) => !existsSync(`${stateDir}/${volume.Name}.copied`),
		);
	}

	/**
	 * Whether the rootless daemon answers, starting it through its `systemd
	 * --user` unit when copying is still pending (a re-run after the daemon
	 * was already disabled).
	 *
	 * @throws When copying is pending and the daemon can't be started.
	 */
	async #ensureRootlessDaemon(
		run: StepRunner,
		{
			pending,
			rootless,
			uid,
			username,
		}: {
			pending: boolean;
			rootless: DockerTarget;
			uid: string;
			username: string;
		},
	): Promise<boolean> {
		if (
			await run.runOk(
				["docker", "version", "--format", "{{.Server.Version}}"],
				rootless,
			)
		) {
			return true;
		}
		if (!pending) {
			console.log("The rootless daemon is already stopped, nothing to stop.");
			return false;
		}
		await run.run(
			["systemctl", "--user", "start", "docker"],
			this.#userSession(username, uid),
		);
		await run.run(
			[
				"bash",
				"-c",
				"for attempt in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
			],
			rootless,
		);
		return true;
	}

	/** What the operator has to look at by hand afterwards : containers that are neither this stack's nor a Homerun service (they won't come back on their own), and host paths bind-mounted into services (their file ownership was mapped through the rootless user's subuids). */
	async #inventory(
		run: StepRunner,
		rootless: DockerTarget,
	): Promise<{ bindMounts: string[]; otherContainers: string[] }> {
		const listing = await run.run(
			[
				"docker",
				"ps",
				"-a",
				"--format",
				'{{.Names}}\t{{.Image}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "homerun.managed"}}\t{{.Label "homerun.infra"}}',
			],
			rootless,
		);
		const otherContainers: string[] = [];
		const managed: string[] = [];
		for (const line of listing.stdout.split("\n").filter(Boolean)) {
			const [name, image, project, isManaged, infra] = line.split("\t");
			if (isManaged === "true") {
				managed.push(name ?? "");
			} else if (project !== "homerun" && !infra) {
				otherContainers.push(`${name} (${image})`);
			}
		}
		if (managed.length === 0) {
			return { bindMounts: [], otherContainers };
		}
		const mounts = await run.run(
			[
				"docker",
				"inspect",
				"--format",
				'{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\\n"}}{{end}}{{end}}',
				...managed,
			],
			rootless,
		);
		const bindMounts = [
			...new Set(
				mounts.stdout
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean),
			),
		];
		return { bindMounts, otherContainers };
	}

	/** Stops every running container on the rootless daemon, the stack and every deployed service, so nothing writes to a volume while it's copied. */
	async #stopAll(run: StepRunner, rootless: DockerTarget): Promise<void> {
		const running = await run.run(["docker", "ps", "-q"], rootless);
		const ids = running.stdout.split("\n").filter(Boolean);
		if (ids.length === 0) {
			console.log("Nothing is running on the rootless daemon.");
			return;
		}
		await run.run(["docker", "stop", ...ids], rootless);
	}

	/**
	 * Records the rootless daemon's named volumes once, then recreates and
	 * fills each one on the system daemon that doesn't have its done marker
	 * yet. A volume left half-copied by an earlier run is removed and copied
	 * again from scratch.
	 *
	 * @throws When volumes still need copying but the rootless daemon isn't reachable.
	 */
	async #copyVolumes(
		run: StepRunner,
		target: {
			reachable: boolean;
			rootless: DockerTarget;
			rootlessSocket: string;
			stateDir: string;
			volumesFile: string;
		},
	): Promise<void> {
		const volumes = await this.#recordVolumes(run, target);
		for (const volume of volumes) {
			const marker = `${target.stateDir}/${volume.Name}.copied`;
			if (existsSync(marker)) {
				console.log(`${volume.Name} already copied, skipping.`);
				continue;
			}
			if (!target.reachable) {
				throw new Error(
					`${volume.Name} still needs copying, but the rootless daemon at ${target.rootlessSocket} isn't reachable.`,
				);
			}
			// biome-ignore lint/performance/noAwaitInLoops: one volume at a time, each copy streams a whole volume between two daemons
			await run.runOk(["docker", "volume", "rm", volume.Name], SYSTEM_DOCKER);
			await run.run(volumeCreateCommand(volume), SYSTEM_DOCKER);
			if (holdsDataElsewhere(volume)) {
				console.log(
					`${volume.Name} keeps its data at ${volume.Options?.device}, recreated without copying.`,
				);
			} else {
				await run.run([
					"bash",
					"-c",
					volumeCopyScript(volume.Name, target.rootlessSocket),
				]);
			}
			await run.writeFile(marker, "");
		}
	}

	/** The volume definitions to copy, read from the state directory, or listed from the rootless daemon and written there on the first run. */
	async #recordVolumes(
		run: StepRunner,
		target: { reachable: boolean; rootless: DockerTarget; volumesFile: string },
	): Promise<VolumeDefinition[]> {
		if (existsSync(target.volumesFile)) {
			return JSON.parse(
				await readFile(target.volumesFile, "utf8"),
			) as VolumeDefinition[];
		}
		if (!target.reachable) {
			return [];
		}
		const listed = await run.run(
			["docker", "volume", "ls", "-q"],
			target.rootless,
		);
		const names = copyableVolumes(listed.stdout.split("\n"));
		if (names.length === 0) {
			await run.writeFile(target.volumesFile, "[]");
			return [];
		}
		const inspected = await run.run(
			["docker", "volume", "inspect", ...names],
			target.rootless,
		);
		const volumes = inspected.stdout.trim()
			? (JSON.parse(inspected.stdout) as VolumeDefinition[])
			: [];
		await run.writeFile(target.volumesFile, JSON.stringify(volumes, null, 2));
		return volumes;
	}

	/** Where the instance is reached : `--domain=`, else the host the old compose file's ORIGIN default carries, else homerun.yaml's baseDomain, else detected. */
	async #host(params: MigrationParams, composeDir: string): Promise<string> {
		if (params.domain) {
			return params.domain;
		}
		const compose = await readFile(`${composeDir}/compose.yaml`, "utf8").catch(
			() => "",
		);
		const config = await readFile(`${composeDir}/homerun.yaml`, "utf8").catch(
			() => "",
		);
		return (
			hostFromCompose(compose) ??
			baseDomainFromConfig(config) ??
			(await params.resolveHost())
		);
	}

	/** Keeps a copy of the rootless compose file (once) and points homerun.yaml's socketPath at the system daemon. */
	async #rewriteConfig(run: StepRunner, composeDir: string): Promise<void> {
		const backup = `${composeDir}/compose.rootless.yaml`;
		if (!existsSync(backup)) {
			await run.run(["cp", `${composeDir}/compose.yaml`, backup]);
		}
		const configPath = `${composeDir}/homerun.yaml`;
		const config = await readFile(configPath, "utf8").catch(() => null);
		if (config !== null) {
			await run.writeFile(configPath, rootfulConfig(config));
		}
	}

	/**
	 * Waits for the app to answer (it has run its migrations by then), then
	 * stores swarm mode, drops a stored rootless socket override and asks
	 * for every service to be redeployed, and restarts the app so its boot
	 * picks that up. Only done once : a re-run doesn't queue the redeploys
	 * again.
	 */
	async #switchInstance(
		run: StepRunner,
		composeDir: string,
		stateDir: string,
	): Promise<void> {
		const marker = `${stateDir}/instance-switched`;
		if (existsSync(marker)) {
			console.log("The instance was already switched to swarm mode, skipping.");
			return;
		}
		const composePath = `${composeDir}/compose.yaml`;
		const compose = { ...SYSTEM_DOCKER, cwd: composeDir };
		await run.run([
			"bash",
			"-c",
			'for attempt in $(seq 1 90); do code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:3000/ || true); case "$code" in 2*|3*|4*) exit 0;; esac; sleep 2; done; echo "The app never answered on :3000" >&2; exit 1',
		]);
		const envFile = await readFile(`${composeDir}/.env`, "utf8").catch(
			() => "",
		);
		await run.run(
			[
				"docker",
				"compose",
				"-f",
				composePath,
				"exec",
				"-T",
				"postgres",
				"psql",
				"-v",
				"ON_ERROR_STOP=1",
				"-U",
				envValue(envFile, "POSTGRES_USER") ?? "homerun",
				"-d",
				envValue(envFile, "POSTGRES_DB") ?? "homerun",
				"-c",
				SWITCH_TO_SWARM_SQL,
			],
			compose,
		);
		await run.run(
			["docker", "compose", "-f", composePath, "restart", "app"],
			compose,
		);
		await run.writeFile(marker, "");
	}

	/** Stops the rootless daemon and keeps it from starting at boot. Its images, containers and volumes stay on disk. */
	async #disableRootlessDaemon(
		run: StepRunner,
		username: string,
		uid: string,
	): Promise<void> {
		const session = this.#userSession(username, uid);
		await run.runOk(
			["systemctl", "--user", "disable", "--now", "docker.socket"],
			session,
		);
		await run.runOk(
			["systemctl", "--user", "disable", "--now", "docker.service"],
			session,
		);
	}

	/** Runs as the rootless user inside its own `systemd --user` session. */
	#userSession(
		username: string,
		uid: string,
	): { as: string; env: Record<string, string> } {
		return {
			as: username,
			env: { HOME: `/home/${username}`, XDG_RUNTIME_DIR: `/run/user/${uid}` },
		};
	}
}

export const RootfulMigration = new RootfulMigrationService();
