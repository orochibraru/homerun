import type { StepRunner } from "../exec";
import { downloadReleaseBinary } from "./release";

/** Downloads the prebuilt `homerun-agent-<arch>` release binary and installs it system-wide. No source, no Bun on the target host, see `release.ts`. */
export async function installAgentBinary(
	run: StepRunner,
	version: string,
	arch: "amd64" | "arm64",
): Promise<string> {
	const binaryPath = "/usr/local/bin/homerun-agent";
	await downloadReleaseBinary(
		run,
		version,
		`homerun-agent-${arch}`,
		binaryPath,
	);
	return binaryPath;
}

/**
 * A systemd --user unit (run as the rootless-Docker user, same session the
 * daemon itself lives in) rather than a system-wide unit : keeps the agent
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
	// heredoc : this is a no-op under --dry-run (see writeFile below).
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
