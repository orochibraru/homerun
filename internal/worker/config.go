package worker

import (
	"fmt"
	"os"
	"strconv"

	"github.com/orochibraru/homerun/internal/dockersocket"
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
	// ID is WORKER_ID, else hostname-pid, recorded on every job it leases.
	ID string
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
	return Config{
		AuthSecret:       secrets.AuthSecretFromEnv(),
		Concurrency:      concurrency,
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		DockerSocketPath: dockersocket.Resolve(os.Getenv("DOCKER_SOCKET_PATH")),
		ID:               id,
	}
}
