package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Config is the agent's environment, read once at startup with sane defaults.
// There's no build step to catch a bad value ahead of time, so the boot banner
// prints the effective values instead.
type Config struct {
	// DockerSocketPath is DOCKER_SOCKET_PATH, else auto-detected, see detectDockerSocketPath.
	DockerSocketPath string
	// ExplicitToken is AGENT_TOKEN, which always wins over a persisted or generated token.
	ExplicitToken string
	// Port is PORT, 7420 by default.
	Port int
	// ShutdownTimeoutSeconds is how long SIGINT/SIGTERM waits for in-flight
	// requests. Deliberately generous: a request here can be a real build (a
	// clone plus a docker build), and killing one mid-way leaves it truncated.
	ShutdownTimeoutSeconds int
	// TokenFile is where a generated token is persisted across restarts.
	TokenFile string
}

// loadConfig reads the agent's configuration from the environment.
func loadConfig() Config {
	return Config{
		DockerSocketPath:       envOr("DOCKER_SOCKET_PATH", ""),
		ExplicitToken:          os.Getenv("AGENT_TOKEN"),
		Port:                   envInt("PORT", 7420),
		ShutdownTimeoutSeconds: envInt("AGENT_SHUTDOWN_TIMEOUT", 120),
		TokenFile:              envOr("AGENT_TOKEN_FILE", filepath.Join(homeDir(), ".homerun-agent", "token")),
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

// homeDir is HOME, else USERPROFILE, else /root.
func homeDir() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	if home := os.Getenv("USERPROFILE"); home != "" {
		return home
	}
	return "/root"
}

// dockerContextHost asks the docker CLI which endpoint its active context uses.
// A variable so tests can stand in for a machine with or without docker.
var dockerContextHost = func() string {
	output, err := exec.Command("docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// detectDockerSocketPath finds the daemon socket when DOCKER_SOCKET_PATH isn't
// set, in the same order as the main app's own detection: DOCKER_HOST, then the
// docker CLI's active context (covers OrbStack, Docker Desktop, Colima or a
// custom context automatically), then common socket locations for a machine
// without the docker CLI, then the conventional default.
func detectDockerSocketPath() string {
	if host := os.Getenv("DOCKER_HOST"); strings.HasPrefix(host, "unix://") {
		return strings.TrimPrefix(host, "unix://")
	}
	if host := dockerContextHost(); strings.HasPrefix(host, "unix://") {
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
