package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

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
	// ExplicitToken is WORKER_TOKEN, the bearer token the app presents to the
	// Docker control API. Unset, both sides derive one from AuthSecret, see
	// httpapi.DeriveToken.
	ExplicitToken string
	// ID is WORKER_ID, else hostname-pid, recorded on every job it leases.
	ID string
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
		AuthSecret:       secrets.AuthSecretFromEnv(),
		Concurrency:      concurrency,
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		DockerSocketPath: dockersocket.Resolve(os.Getenv("DOCKER_SOCKET_PATH")),
		ExplicitToken:    os.Getenv("WORKER_TOKEN"),
		ID:               id,
		TokenFile:        os.Getenv("WORKER_TOKEN_FILE"),
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
