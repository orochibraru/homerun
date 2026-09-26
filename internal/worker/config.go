package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/orochibraru/homerun/internal/dockersocket"
	"github.com/orochibraru/homerun/internal/httpapi"
	"github.com/orochibraru/homerun/internal/secrets"
)

// Config is the worker's environment, read once at startup.
type Config struct {
	// AuthSecret is the app's AUTH_SECRET, which job specs are encrypted with.
	AuthSecret string
	// Concurrency is WORKER_CONCURRENCY, 3 by default.
	Concurrency int
	// DatabaseURL is DATABASE_URL, the app's own Postgres.
	DatabaseURL string
	// DockerSocketPath is DOCKER_SOCKET_PATH, else auto-detected.
	DockerSocketPath string
	// DockerStallTimeout is WORKER_DOCKER_STALL_TIMEOUT, 10m by default: how
	// long a Docker stream may go without a byte or a sign of life.
	DockerStallTimeout time.Duration
	// DockerTimeout is WORKER_DOCKER_TIMEOUT, 60s by default: one Docker
	// control call's deadline.
	DockerTimeout time.Duration
	// ExplicitToken is WORKER_TOKEN, the bearer token the app presents to the
	// Docker control API. Unset, both sides derive one from AuthSecret, see
	// httpapi.DeriveToken.
	ExplicitToken string
	// ID is WORKER_ID, else hostname-pid, recorded on every job it leases.
	ID string
	// JobStallTimeout is WORKER_JOB_STALL_TIMEOUT, 15m by default: a job that
	// made no progress this long fails even though it still heartbeats.
	JobStallTimeout time.Duration
	// Port is WORKER_PORT. Unset, it's 7430 next to the app and 7420 in agent
	// mode, the port every registered remote host's URL and firewall rule
	// already points at.
	Port int
	// TokenFile is WORKER_TOKEN_FILE, where agent mode persists the token it
	// generates when WORKER_TOKEN is unset. Unused next to the app, whose token
	// is derived from AUTH_SECRET instead.
	TokenFile string
}

// AgentMode reports whether this worker runs on a remote build host: no
// DATABASE_URL means there's no job table to lease from, only builds to serve.
func (c Config) AgentMode() bool {
	return c.DatabaseURL == ""
}

// LoadConfig reads the worker's Config from its environment.
func LoadConfig() Config {
	id := os.Getenv("WORKER_ID")
	if id == "" {
		host, _ := os.Hostname()
		id = fmt.Sprintf("%s-%d", host, os.Getpid())
	}
	concurrency, err := strconv.Atoi(os.Getenv("WORKER_CONCURRENCY"))
	if err != nil || concurrency < 1 {
		concurrency = 3
	}
	config := Config{
		AuthSecret:         secrets.AuthSecretFromEnv(),
		Concurrency:        concurrency,
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		DockerSocketPath:   dockersocket.Resolve(os.Getenv("DOCKER_SOCKET_PATH")),
		DockerStallTimeout: durationEnv("WORKER_DOCKER_STALL_TIMEOUT", 10*time.Minute),
		DockerTimeout:      durationEnv("WORKER_DOCKER_TIMEOUT", 60*time.Second),
		ExplicitToken:      os.Getenv("WORKER_TOKEN"),
		ID:                 id,
		JobStallTimeout:    durationEnv("WORKER_JOB_STALL_TIMEOUT", 15*time.Minute),
		TokenFile:          os.Getenv("WORKER_TOKEN_FILE"),
	}
	if config.TokenFile == "" {
		config.TokenFile = filepath.Join(httpapi.HomeDir(), ".homerun-worker", "token")
	}
	port, err := strconv.Atoi(os.Getenv("WORKER_PORT"))
	switch {
	case err == nil && port > 0:
		config.Port = port
	case config.AgentMode():
		config.Port = 7420
	default:
		config.Port = 7430
	}
	return config
}

// durationEnv parses the Go duration in env var name ("90s", "15m"), or
// returns fallback when it's unset, unparseable or not positive.
func durationEnv(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(os.Getenv(name))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
