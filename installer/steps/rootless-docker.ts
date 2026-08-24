import type { StepRunner } from "../exec";
import { commandExists } from "../exec";
import type { PackageManager } from "./detect";

/** Rootless-Docker setup : engine install, prereqs, the dedicated system user, and the actual rootless daemon. Grouped as a class for consistency with the rest of installer/steps/. */
class RootlessDockerInstallerService {
	/**
	 * Installs Docker Engine (rootful, via the official convenience script : the
	 * same one Docker's own docs point to) plus the rootless-extras package it
	 * ships alongside, which is what dockerd-rootless-setuptool.sh below needs.
	 * Rootful dockerd itself is left disabled : only the rootless daemon for
	 * `rootlessUser` actually runs services, per the requirement that deployed
	 * containers live under a non-root, rootless-permission account.
	 */
	async installDockerEngine(run: StepRunner): Promise<void> {
		if (await commandExists("docker")) {
			console.log("Docker already installed, skipping engine install.");
			return;
		}
		await run.run(["sh", "-c", "curl -fsSL https://get.docker.com | sh"]);
	}

	/** uidmap/dbus-user-session are the host-level prerequisites rootless Docker's subuid/subgid mapping and systemd --user session need : not bundled by the convenience script. */
	async installRootlessPrereqs(
		run: StepRunner,
		pm: PackageManager,
	): Promise<void> {
		const pkgs =
			pm.kind === "apt" ? ["uidmap", "dbus-user-session"] : ["shadow-utils"];
		await run.run([...pm.install, ...pkgs]);
	}

	/** Creates the dedicated rootless-Docker user if it doesn't already exist. Idempotent. */
	async ensureRootlessUser(run: StepRunner, username: string): Promise<void> {
		const exists = await run.runOk(["id", username]);
		if (exists) {
			console.log(`User "${username}" already exists, reusing it.`);
			return;
		}
		await run.run([
			"useradd",
			"--create-home",
			"--shell",
			"/bin/bash",
			username,
		]);
	}

	/**
	 * The actual rootless Docker install + enable, run *as* the target user :
	 * this is Docker's own documented rootless flow
	 * (https://docs.docker.com/engine/security/rootless/), not a homegrown one:
	 *  1. get.docker.com/rootless installs dockerd-rootless into ~<user>/bin and
	 *     writes a systemd --user unit for it.
	 *  2. `loginctl enable-linger` (root-only) makes that systemd --user
	 *     instance start at boot without an active login session : required on
	 *     a headless server, otherwise the daemon dies the moment the install
	 *     SSH session ends.
	 *  3. `systemctl --user enable --now docker` starts it and makes it survive
	 *     reboots.
	 * Returns the rootless daemon's socket path : this is what both the
	 * installer's own network-creation step and the agent's DOCKER_SOCKET_PATH
	 * need to point at, since it isn't /var/run/docker.sock.
	 */
	async installRootlessDocker(
		run: StepRunner,
		username: string,
	): Promise<string> {
		await run.run(["loginctl", "enable-linger", username]);

		const uidResult = await run.run(["id", "-u", username]);
		const uid = uidResult.stdout.trim() || "<uid>";
		const xdgRuntimeDir = `/run/user/${uid}`;

		await run.run(
			["sh", "-c", "curl -fsSL https://get.docker.com/rootless | sh"],
			{
				as: username,
				env: { HOME: `/home/${username}`, XDG_RUNTIME_DIR: xdgRuntimeDir },
			},
		);

		await run.run(["systemctl", "--user", "enable", "--now", "docker"], {
			as: username,
			env: { HOME: `/home/${username}`, XDG_RUNTIME_DIR: xdgRuntimeDir },
		});

		return `${xdgRuntimeDir}/docker.sock`;
	}
}

export const RootlessDockerInstaller = new RootlessDockerInstallerService();
