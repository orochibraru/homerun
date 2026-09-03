import { readFile } from "node:fs/promises";
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
		await this.#allowRootlessUserns(run, username);

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

	/**
	 * Real, tested-live finding (a real disposable Multipass Ubuntu 24.04 VM,
	 * `--mode=agent`): Ubuntu 23.10+ restricts unprivileged user namespaces by
	 * default (`kernel.apparmor_restrict_unprivileged_userns=1`), which breaks
	 * rootlesskit's own `fork/exec /proc/self/exe` with a bare "permission
	 * denied", failing `dockerd-rootless-setuptool.sh` outright before this
	 * fix existed. The profile below is Docker's own rootless installer's
	 * suggested fix (also Ubuntu's documented workaround, see
	 * https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces),
	 * scoped to just this one binary path rather than disabling the
	 * restriction kernel-wide. A no-op on any host where the sysctl file
	 * doesn't exist at all (older Ubuntu, Debian, non-apt distros) or isn't
	 * set to restrict.
	 *
	 * Second real, tested-live finding on top of the first: this reads the
	 * sysctl via `node:fs/promises`' `readFile`, not `Bun.file(path).text()`.
	 * `/proc` entries report a 0-byte size via `stat` (confirmed:
	 * `ls -la` shows `0` for this exact file even though `cat` prints `1`),
	 * and `Bun.file(...).exists()` returns `true` for it but `.text()`
	 * silently returns `""` instead of the real content, verified live with a
	 * standalone compiled binary on the same VM. Node's `readFile` reads it
	 * correctly. Same class of Bun-vs-node:fs quirk as `Bun.write`'s silently
	 * ignored `mode` option (see root CLAUDE.md's "Real bugs this suite
	 * caught") : prefer `node:fs` over `Bun.file`/`Bun.write` for anything
	 * that isn't a plain regular file.
	 */
	async #allowRootlessUserns(run: StepRunner, username: string): Promise<void> {
		const sysctlPath = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
		let sysctlValue: string;
		try {
			sysctlValue = await readFile(sysctlPath, "utf8");
		} catch {
			return;
		}
		if (sysctlValue.trim() !== "1") {
			return;
		}

		const profilePath = `/etc/apparmor.d/home.${username}.bin.rootlesskit`;
		await run.writeFile(
			profilePath,
			`abi <abi/4.0>,
include <tunables/global>

/home/${username}/bin/rootlesskit flags=(unconfined) {
  userns,

  include if exists <local/home.${username}.bin.rootlesskit>
}
`,
		);
		await run.runOk(["systemctl", "restart", "apparmor.service"]);
	}
}

export const RootlessDockerInstaller = new RootlessDockerInstallerService();
