package agent

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/orochibraru/homerun/internal/httpapi"
)

// Config is the agent's environment, read once at startup with sane defaults.
// There's no build step to catch a bad value ahead of time, so the boot banner
// prints the effective values instead.
type Config struct {
	// DockerSocketPath is DOCKER_SOCKET_PATH, else auto-detected, see dockersocket.Detect.
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

// LoadConfig reads the agent's configuration from the environment.
func LoadConfig() Config {
	return Config{
		DockerSocketPath:       envOr("DOCKER_SOCKET_PATH", ""),
		ExplicitToken:          os.Getenv("AGENT_TOKEN"),
		Port:                   envInt("PORT", 7420),
		ShutdownTimeoutSeconds: envInt("AGENT_SHUTDOWN_TIMEOUT", 120),
		TokenFile:              envOr("AGENT_TOKEN_FILE", filepath.Join(httpapi.HomeDir(), ".homerun-agent", "token")),
	}
}

// envOr reads key from the environment, or returns fallback when it's unset
// or empty.
func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// envInt reads key from the environment as an integer, or returns fallback
// when it's unset or unparseable.
func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}
