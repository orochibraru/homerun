package installer

import "fmt"

// legacyWorkerBinaryPath is where agent installs put the worker before it
// could update itself, root-owned and so not replaceable by it.
const legacyWorkerBinaryPath = "/usr/local/bin/homerun-worker"

// WorkerBinaryPath is where the worker binary lives for the rootless user:
// in a directory that user owns, so the worker can rename an updated release
// over itself from the Remote Hosts page.
func WorkerBinaryPath(username string) string {
	return HomeOf(username) + "/bin/homerun-worker"
}

// legacyAgentBinaryPath and legacyAgentUnit are what the retired homerun-agent
// binary left behind on a host installed before it was merged into the worker.
const (
	legacyAgentBinaryPath = "/usr/local/bin/homerun-agent"
	legacyAgentUnit       = "homerun-agent"
)

// InstallWorkerBinary downloads the prebuilt homerun-worker-<arch> release
// binary into WorkerBinaryPath, owned by username, and removes the root-owned
// copy an older install left in /usr/local/bin. No source, no runtime on the
// target host, see release.go.
func InstallWorkerBinary(run Runner, username, version, arch string) (string, error) {
	path := WorkerBinaryPath(username)
	dir := HomeOf(username) + "/bin"
	if _, err := run.Run([]string{"mkdir", "-p", dir}, Opts{}); err != nil {
		return "", err
	}
	if err := DownloadReleaseBinary(run, version, "homerun-worker-"+arch, path); err != nil {
		return "", err
	}
	if _, err := run.Run([]string{"chown", username + ":" + username, dir, path}, Opts{}); err != nil {
		return "", err
	}
	if _, err := run.Run([]string{"rm", "-f", legacyWorkerBinaryPath}, Opts{}); err != nil {
		return "", err
	}
	return path, nil
}

// WorkerUnitParams is what the agent-mode worker's systemd unit needs to know.
type WorkerUnitParams struct {
	BinaryPath   string
	DockerSocket string
	Port         int
	TokenFile    string
}

// WorkerSystemdUnit is the worker's systemd --user unit in agent mode (no
// DATABASE_URL), run as the rootless-Docker user in the same session the daemon
// itself lives in, so the worker stays under the same non-root account as the
// containers it builds.
func WorkerSystemdUnit(params WorkerUnitParams) string {
	return fmt.Sprintf(`[Unit]
Description=Homerun worker (agent mode)
After=docker.service
Wants=docker.service

[Service]
ExecStart=%s
Restart=on-failure
Environment=WORKER_PORT=%d
Environment=DOCKER_SOCKET_PATH=%s
Environment=WORKER_TOKEN_FILE=%s

[Install]
WantedBy=default.target
`, params.BinaryPath, params.Port, params.DockerSocket, params.TokenFile)
}

// InstallWorkerSystemdUnit writes the agent-mode worker's systemd --user unit
// into the rootless user's config directory, hands it to that user, removes a
// leftover homerun-agent unit and binary from before the agent was merged into
// the worker, then reloads, enables and restarts the worker, so a re-run picks
// up a replaced binary or unit instead of leaving the old process running.
//
// dockerSocket is the rootless daemon's socket path the worker should talk to.
func InstallWorkerSystemdUnit(run Runner, username, dockerSocket string, port int) error {
	home := HomeOf(username)
	unitDir := home + "/.config/systemd/user"
	unit := WorkerSystemdUnit(WorkerUnitParams{
		BinaryPath:   WorkerBinaryPath(username),
		DockerSocket: dockerSocket,
		Port:         port,
		TokenFile:    home + "/.homerun-worker/token",
	})

	if _, err := run.Run([]string{"mkdir", "-p", unitDir}, Opts{As: username}); err != nil {
		return err
	}
	if err := run.WriteFile(unitDir+"/homerun-worker.service", unit); err != nil {
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
	run.RunOK([]string{"systemctl", "--user", "disable", "--now", legacyAgentUnit}, session)
	if _, err := run.Run([]string{"rm", "-f", unitDir + "/" + legacyAgentUnit + ".service", legacyAgentBinaryPath}, Opts{}); err != nil {
		return err
	}
	for _, command := range [][]string{
		{"systemctl", "--user", "daemon-reload"},
		{"systemctl", "--user", "enable", "homerun-worker"},
		{"systemctl", "--user", "restart", "homerun-worker"},
	} {
		if _, err := run.Run(command, session); err != nil {
			return err
		}
	}
	return nil
}
