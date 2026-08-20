import type { StepRunner } from "../exec";
import { commandExists } from "../exec";

const BUN_INSTALL_SCRIPT = "https://bun.sh/install";

/** No prebuilt-binary release feed exists yet (see installer/README.md) — every install builds the agent from source, same as a developer would. */
export async function ensureBunInstalled(
	run: StepRunner,
	username: string,
): Promise<void> {
	const has = await run.runOk(["bash", "-lc", "command -v bun"], {
		as: username,
	});
	if (has) {
		return;
	}
	await run.run(["bash", "-c", `curl -fsSL ${BUN_INSTALL_SCRIPT} | bash`], {
		as: username,
		env: { HOME: `/home/${username}` },
	});
}

export async function cloneRepo(
	run: StepRunner,
	username: string,
	repoUrl: string,
	repoRef: string,
	dest: string,
): Promise<void> {
	if (!repoUrl) {
		throw new Error(
			"--repo=<git url> is required (or set HOMERUN_REPO_URL) — see --help.",
		);
	}
	const alreadyCloned = await run.runOk(["test", "-d", `${dest}/.git`], {
		as: username,
	});
	if (alreadyCloned) {
		await run.run(
			["git", "-C", dest, "fetch", "--depth", "1", "origin", repoRef],
			{
				as: username,
			},
		);
		await run.run(["git", "-C", dest, "checkout", repoRef], { as: username });
		return;
	}
	await run.run(
		[
			"git",
			"clone",
			"--depth",
			"1",
			"--branch",
			repoRef,
			"--single-branch",
			repoUrl,
			dest,
		],
		{ as: username },
	);
}

/** Builds agent/ from the cloned checkout and installs the compiled binary system-wide. */
export async function buildAndInstallAgent(
	run: StepRunner,
	username: string,
	repoDir: string,
): Promise<string> {
	const bunBin = `/home/${username}/.bun/bin/bun`;
	const bunPath = (await commandExists("bun")) ? "bun" : bunBin;

	await run.run([bunPath, "install"], {
		as: username,
		cwd: `${repoDir}/agent`,
	});
	await run.run([bunPath, "run", "build"], {
		as: username,
		cwd: `${repoDir}/agent`,
	});

	const binaryPath = "/usr/local/bin/homerun-agent";
	await run.run(["cp", `${repoDir}/agent/dist/homerun-agent`, binaryPath]);
	await run.run(["chmod", "+x", binaryPath]);
	return binaryPath;
}

/**
 * A systemd --user unit (run as the rootless-Docker user, same session the
 * daemon itself lives in) rather than a system-wide unit — keeps the agent
 * process under the same non-root account as the containers it manages,
 * consistent with the "rootless permissions" requirement.
 */
export function agentSystemdUnit(opts: {
	binaryPath: string;
	dockerSocket: string;
	port: number;
	tokenFile: string;
}): string {
	return `[Unit]
Description=Homerun Agent
After=docker.service
Wants=docker.service

[Service]
ExecStart=${opts.binaryPath}
Restart=on-failure
Environment=PORT=${opts.port}
Environment=DOCKER_SOCKET_PATH=${opts.dockerSocket}
Environment=AGENT_TOKEN_FILE=${opts.tokenFile}

[Install]
WantedBy=default.target
`;
}

export async function installAgentSystemdUnit(
	run: StepRunner,
	username: string,
	dockerSocket: string,
	port: number,
): Promise<void> {
	const unitDir = `/home/${username}/.config/systemd/user`;
	const tokenFile = `/home/${username}/.homerun-agent/token`;
	const unit = agentSystemdUnit({
		binaryPath: "/usr/local/bin/homerun-agent",
		dockerSocket,
		port,
		tokenFile,
	});

	await run.run(["mkdir", "-p", unitDir], { as: username });
	// StepRunner's `run` captures stdout/stderr but has no stdin-piping path,
	// so the unit file is written directly rather than via a `cat > file`
	// heredoc — this is a no-op under --dry-run (see writeFile below).
	await run.writeFile(`${unitDir}/homerun-agent.service`, unit);
	await run.run(["chown", "-R", `${username}:${username}`, unitDir]);

	const env = {
		HOME: `/home/${username}`,
		XDG_RUNTIME_DIR: `/run/user/${await uidOf(run, username)}`,
	};
	await run.run(["systemctl", "--user", "daemon-reload"], {
		as: username,
		env,
	});
	await run.run(["systemctl", "--user", "enable", "--now", "homerun-agent"], {
		as: username,
		env,
	});
}

async function uidOf(run: StepRunner, username: string): Promise<string> {
	const result = await run.run(["id", "-u", username]);
	return result.stdout.trim() || "1000";
}
