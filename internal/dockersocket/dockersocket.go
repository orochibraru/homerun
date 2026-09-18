// Package dockersocket finds the local Docker daemon's unix socket, shared by
// every Homerun binary that talks to Docker without being told where it is.
package dockersocket

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// contextHost asks the docker CLI which endpoint its active context uses.
// A variable so tests can stand in for a machine with or without docker.
var contextHost = func() string {
	output, err := exec.Command("docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// Resolve returns explicit when set, else Detect().
func Resolve(explicit string) string {
	if explicit != "" {
		return explicit
	}
	return Detect()
}

// Detect finds the daemon socket in the same order as the main app's own
// detection: DOCKER_HOST, then the docker CLI's active context (covers
// OrbStack, Docker Desktop, Colima or a custom context automatically), then
// common socket locations for a machine without the docker CLI, then the
// conventional default.
func Detect() string {
	if host := os.Getenv("DOCKER_HOST"); strings.HasPrefix(host, "unix://") {
		return strings.TrimPrefix(host, "unix://")
	}
	if host := contextHost(); strings.HasPrefix(host, "unix://") {
		return strings.TrimPrefix(host, "unix://")
	}
	home, _ := os.UserHomeDir()
	for _, candidate := range []string{
		"/var/run/docker.sock",
		filepath.Join(home, ".orbstack", "run", "docker.sock"),
		filepath.Join(home, ".docker", "run", "docker.sock"),
		filepath.Join(home, ".colima", "default", "docker.sock"),
	} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "/var/run/docker.sock"
}
