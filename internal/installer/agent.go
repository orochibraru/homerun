package installer

import "fmt"

// agentBinaryPath is where the agent binary is installed system-wide.
const agentBinaryPath = "/usr/local/bin/homerun-agent"

// InstallAgentBinary downloads the prebuilt homerun-agent-<arch> release binary
// and installs it system-wide. No source, no runtime on the target host, see
// release.go.
func InstallAgentBinary(run Runner, version, arch string) (string, error) {
	if err := DownloadReleaseBinary(run, version, "homerun-agent-"+arch, agentBinaryPath); err != nil {
		return "", err
	}
	return agentBinaryPath, nil
}

// AgentUnitParams is what the agent's systemd unit needs to know.
type AgentUnitParams struct {
	BinaryPath   string
	DockerSocket string
	Port         int
	TokenFile    string
}

// AgentSystemdUnit is a systemd --user unit (run as the rootless-Docker user,
// same session the daemon itself lives in) rather than a system-wide unit: it
// keeps the agent process under the same non-root account as the containers it
// manages, consistent with the "rootless permissions" requirement.
func AgentSystemdUnit(params AgentUnitParams) string {
	return fmt.Sprintf(`[Unit]
Description=Homerun Agent
After=docker.service
Wants=docker.service

[Service]
ExecStart=%s
Restart=on-failure
Environment=PORT=%d
Environment=DOCKER_SOCKET_PATH=%s
Environment=AGENT_TOKEN_FILE=%s

[Install]
WantedBy=default.target
`, params.BinaryPath, params.Port, params.DockerSocket, params.TokenFile)
}

// InstallAgentSystemdUnit writes the agent's systemd --user unit into the
// rootless user's config directory, hands it to that user, then reloads,
// enables and restarts it, so a re-run picks up a replaced binary or unit
// instead of leaving the old process running.
//
// dockerSocket is the rootless daemon's socket path the agent should talk to.
func InstallAgentSystemdUnit(run Runner, username, dockerSocket string, port int) error {
	home := HomeOf(username)
	unitDir := home + "/.config/systemd/user"
	unit := AgentSystemdUnit(AgentUnitParams{
		BinaryPath:   agentBinaryPath,
		DockerSocket: dockerSocket,
		Port:         port,
		TokenFile:    home + "/.homerun-agent/token",
	})

	if _, err := run.Run([]string{"mkdir", "-p", unitDir}, Opts{As: username}); err != nil {
		return err
	}
	// Run has no stdin-piping path, so the unit file is written directly rather
	// than via a `cat > file` heredoc : a no-op under --dry-run.
	if err := run.WriteFile(unitDir+"/homerun-agent.service", unit); err != nil {
		return err
	}
	if _, err := run.Run([]string{"chown", "-R", username + ":" + username, unitDir}, Opts{}); err != nil {
		return err
	}

	uid, err := UIDOf(run, username)
	if err != nil {
		return err
	}
	session := Opts{
		As:  username,
		Env: map[string]string{"HOME": home, "XDG_RUNTIME_DIR": "/run/user/" + uid},
	}
	for _, command := range [][]string{
		{"systemctl", "--user", "daemon-reload"},
		{"systemctl", "--user", "enable", "homerun-agent"},
		{"systemctl", "--user", "restart", "homerun-agent"},
	} {
		if _, err := run.Run(command, session); err != nil {
			return err
		}
	}
	return nil
}
