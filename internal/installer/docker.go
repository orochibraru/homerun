package installer

import (
	"fmt"
	"os"
	"strings"
)

const (
	// SystemDockerSocket is the system daemon's socket path.
	SystemDockerSocket = "/var/run/docker.sock"
	// SwarmNetwork is the attachable overlay swarm services join, named and
	// shaped the way the app's own ensureSwarmNetwork makes it.
	SwarmNetwork = "homerun-swarm"
)

// UsernsSysctlPath is the AppArmor unprivileged-userns restriction toggle. A
// variable so tests can point it at a scratch file.
var UsernsSysctlPath = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns"

// systemDocker targets the system daemon.
var systemDocker = Opts{Env: map[string]string{"DOCKER_HOST": "unix://" + SystemDockerSocket}}

// InstallDockerEngine installs Docker Engine (rootful, via the official
// convenience script: the same one Docker's own docs point to). The rootless
// extras it ships alongside are what installRootlessPrereqs adds.
func InstallDockerEngine(run Runner) error {
	if CommandExists("docker") {
		fmt.Println("Docker already installed, skipping engine install.")
		return nil
	}
	_, err := run.Run([]string{"sh", "-c", "curl -fsSL https://get.docker.com | sh"}, Opts{})
	return err
}

// InstallRootlessPrereqs installs uidmap/dbus-user-session, the host-level
// prerequisites rootless Docker's subuid/subgid mapping and systemd --user
// session need: not bundled by the convenience script.
func InstallRootlessPrereqs(run Runner, pm PackageManager) error {
	packages := []string{"shadow-utils"}
	if pm.Kind == "apt" {
		packages = []string{"uidmap", "dbus-user-session"}
	}
	_, err := run.Run(append(append([]string{}, pm.Install...), packages...), Opts{})
	return err
}

// EnsureRootlessUser creates the dedicated rootless-Docker user if it doesn't
// already exist. Idempotent.
func EnsureRootlessUser(run Runner, username string) error {
	if run.RunOK([]string{"id", username}, Opts{}) {
		fmt.Printf("User %q already exists, reusing it.\n", username)
		return nil
	}
	_, err := run.Run([]string{"useradd", "--create-home", "--shell", "/bin/bash", username}, Opts{})
	return err
}

// InstallRootlessDocker performs the actual rootless Docker install and enable,
// run as the target user. This is Docker's own documented rootless flow
// (https://docs.docker.com/engine/security/rootless/), not a homegrown one:
//
//  1. get.docker.com/rootless installs dockerd-rootless into ~<user>/bin and
//     writes a systemd --user unit for it.
//  2. `loginctl enable-linger` (root-only) makes that systemd --user instance
//     start at boot without an active login session: required on a headless
//     server, otherwise the daemon dies the moment the install SSH session ends.
//  3. `systemctl --user enable --now docker` starts it and makes it survive
//     reboots.
//
// Returns the rootless daemon's socket path: this is what both the installer's
// own network-creation step and the agent's DOCKER_SOCKET_PATH need to point
// at, since it isn't /var/run/docker.sock.
func InstallRootlessDocker(run Runner, username string) (string, error) {
	if _, err := run.Run([]string{"loginctl", "enable-linger", username}, Opts{}); err != nil {
		return "", err
	}
	if err := AllowRootlessUserns(run, username); err != nil {
		return "", err
	}

	uid, err := UIDOf(run, username)
	if err != nil {
		return "", err
	}
	xdgRuntimeDir := "/run/user/" + uid
	session := Opts{
		As:  username,
		Env: map[string]string{"HOME": HomeOf(username), "XDG_RUNTIME_DIR": xdgRuntimeDir},
	}

	if FileExists(HomeOf(username) + "/bin/dockerd") {
		fmt.Printf("Rootless Docker already installed for %q, skipping.\n", username)
	} else {
		if _, err := run.Run(
			[]string{"sh", "-c", "curl -fsSL https://get.docker.com/rootless | sh"},
			session,
		); err != nil {
			return "", err
		}
	}

	if _, err := run.Run([]string{"systemctl", "--user", "enable", "--now", "docker"}, session); err != nil {
		return "", err
	}
	return xdgRuntimeDir + "/docker.sock", nil
}

// EnableRootfulDocker starts the system daemon get.docker.com installed and
// makes it survive reboots, instead of a per-user rootless one. Swarm mode
// needs this: rootless Docker can't create the overlay networks a swarm service
// joins (verified live, the daemon fails the task with
// `mkdir /var/lib/docker/network: permission denied`).
//
// Returns the system daemon's socket path.
func EnableRootfulDocker(run Runner) (string, error) {
	if _, err := run.Run([]string{"systemctl", "enable", "--now", "docker"}, Opts{}); err != nil {
		return "", err
	}
	return SystemDockerSocket, nil
}

// AddUserToDockerGroup adds the install user to the `docker` group
// get.docker.com creates, so it can reach the system daemon's socket without
// sudo. Idempotent.
func AddUserToDockerGroup(run Runner, username string) error {
	_, err := run.Run([]string{"usermod", "-aG", "docker", username}, Opts{})
	return err
}

// AllowRootlessUserns works around Ubuntu's unprivileged-userns restriction.
//
// Real, tested-live finding (a real disposable Multipass Ubuntu 24.04 VM,
// --mode=agent): Ubuntu 23.10+ restricts unprivileged user namespaces by
// default (kernel.apparmor_restrict_unprivileged_userns=1), which breaks
// rootlesskit's own fork/exec /proc/self/exe with a bare "permission denied",
// failing dockerd-rootless-setuptool.sh outright before this fix existed. The
// profile below is Docker's own rootless installer's suggested fix (also
// Ubuntu's documented workaround), scoped to just this one binary path rather
// than disabling the restriction kernel-wide. A no-op on any host where the
// sysctl file doesn't exist at all (older Ubuntu, Debian, non-apt distros) or
// isn't set to restrict.
//
// The Bun implementation this replaces needed a second finding recorded here:
// /proc entries report a 0-byte size, and Bun.file().text() silently returned
// "" for this file while node:fs read it correctly. Go's os.ReadFile has no
// such quirk, so the workaround is gone but the profile it writes is unchanged.
func AllowRootlessUserns(run Runner, username string) error {
	if ReadTrimmed(UsernsSysctlPath) != "1" {
		return nil
	}

	profilePath := fmt.Sprintf("/etc/apparmor.d/home.%s.bin.rootlesskit", username)
	profile := fmt.Sprintf(`abi <abi/4.0>,
include <tunables/global>

%s/bin/rootlesskit flags=(unconfined) {
  userns,

  include if exists <local/home.%s.bin.rootlesskit>
}
`, HomeOf(username), username)
	if err := run.WriteFile(profilePath, profile); err != nil {
		return err
	}
	run.RunOK([]string{"systemctl", "restart", "apparmor.service"}, Opts{})
	return nil
}

// ReadTrimmed is a file's trimmed contents, or the empty string when it can't
// be read at all: every caller here treats "unreadable" and "absent" alike.
func ReadTrimmed(path string) string {
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

// UIDOf looks up a user's numeric uid for its XDG_RUNTIME_DIR, falling back to
// 1000 when `id` prints nothing (as under --dry-run).
func UIDOf(run Runner, username string) (string, error) {
	result, err := run.Run([]string{"id", "-u", username}, Opts{})
	if err != nil {
		return "", err
	}
	uid := strings.TrimSpace(result.Stdout)
	if uid == "" {
		return "1000", nil
	}
	return uid, nil
}

// EnsureHomerunNetwork creates the shared network on the daemon behind
// dockerSocket, same name convention as the main app's homerun. Idempotent:
// docker network create errors on a duplicate name, so it checks first.
//
// username is the rootless user whose daemon this is, or empty for the system
// daemon, which root reaches directly.
func EnsureHomerunNetwork(run Runner, username, dockerSocket string) error {
	target := Opts{Env: map[string]string{"DOCKER_HOST": "unix://" + dockerSocket}}
	if username != "" {
		target.As = username
		target.Env["HOME"] = HomeOf(username)
	}
	if run.RunOK([]string{"docker", "network", "inspect", "homerun"}, target) {
		fmt.Println("homerun already exists, skipping.")
		return nil
	}
	_, err := run.Run([]string{"docker", "network", "create", "homerun"}, target)
	return err
}
