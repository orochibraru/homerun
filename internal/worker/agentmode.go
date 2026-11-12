package worker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/zedensix/homerun/internal/agent"
	"github.com/zedensix/homerun/internal/buildinfo"
	"github.com/zedensix/homerun/internal/dockerapi"
	"github.com/zedensix/homerun/internal/hoststats"
	"github.com/zedensix/homerun/internal/httpapi"
	"github.com/zedensix/homerun/internal/logging"
	"github.com/zedensix/homerun/internal/workstation"
)

// runAgent is the worker on a remote host: no Postgres, no job loop, only the
// narrow HTTP surface a remote host needs (health, host stats, a git build,
// exporting the image it built, and dev workstations).
//
// The route set is deliberately not the worker's Docker control API. That API
// is exec, a terminal and arbitrary container creation, so on a host reached
// over the network a leaked token would be the whole daemon; a remote host only
// ever needs to be asked to build, or to run a workstation from a narrow spec.
//
// The token can't be derived from AUTH_SECRET here the way the local worker's
// is, because a remote host doesn't have it. It's WORKER_TOKEN, else one
// generated on first start and persisted, which the operator pastes into the
// Remote Hosts page once.
func runAgent(config Config) error {
	token, source, err := httpapi.ResolveToken(config.ExplicitToken, config.TokenFile)
	if err != nil {
		return fmt.Errorf("couldn't resolve the worker token: %w", err)
	}
	docker := dockerapi.New(config.DockerSocketPath)
	ping, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := docker.Ping(ping); err != nil {
		return fmt.Errorf("docker isn't reachable at %s: %w", config.DockerSocketPath, err)
	}

	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("couldn't find the worker's own binary: %w", err)
	}
	logs := agent.NewLogBuffer(agentLogLines)
	log.SetOutput(io.MultiWriter(os.Stderr, logs))
	restart := make(chan struct{})
	var restartOnce sync.Once
	admin := &agent.Admin{
		Docker:     docker,
		Download:   agent.ReleaseDownload(executable),
		Executable: executable,
		Logs:       logs,
		Restart:    func() { restartOnce.Do(func() { close(restart) }) },
	}

	server := agent.NewServer(token, docker, agent.NewBuilder(docker, config.DockerSocketPath), hoststats.NewStatsSampler(),
		workstation.NewManager(docker).Mount, admin.Mount)
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", config.Port))
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: server.Handler(), ReadHeaderTimeout: 30 * time.Second}

	PrintAgentBanner(config, token, source)
	err = serveUntilSignalled(httpServer, listener, agentShutdownGrace, restart)
	if !errors.Is(err, errRestart) {
		return err
	}
	logging.Infof(scope, "restarting into the updated binary")
	return syscall.Exec(executable, os.Args, os.Environ())
}

// agentLogLines is how many of its own log lines agent mode keeps for GET /v1/logs.
const agentLogLines = 2000

// errRestart is serveUntilSignalled's answer when it stopped for a restart
// into an updated binary rather than for a signal.
var errRestart = errors.New("restart requested")

// agentShutdownGrace is how long a stop waits for in-flight requests in agent
// mode. Generous on purpose: a request there can be a whole build (a clone plus
// a docker build), and cutting one off leaves it truncated.
const agentShutdownGrace = 120 * time.Second

// serveUntilSignalled serves until SIGINT or SIGTERM, or until restart is
// closed, then shuts down gracefully, bounded by timeout. A second signal while
// waiting forces an immediate exit, the usual "one more Ctrl+C to really stop"
// escape hatch. A clean shutdown for a restart returns errRestart.
func serveUntilSignalled(httpServer *http.Server, listener net.Listener, timeout time.Duration, restart <-chan struct{}) error {
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	served := make(chan error, 1)
	go func() { served <- httpServer.Serve(listener) }()

	restarting := false
	select {
	case err := <-served:
		return err
	case received := <-signals:
		logging.Infof(scope, "received %s, shutting down (waiting up to %s for any in-flight build)", received, timeout)
	case <-restart:
		restarting = true
		logging.Infof(scope, "restarting for an update (waiting up to %s for any in-flight build)", timeout)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	shutdown := make(chan error, 1)
	go func() { shutdown <- httpServer.Shutdown(ctx) }()

	select {
	case err := <-shutdown:
		if errors.Is(err, context.DeadlineExceeded) {
			logging.Warnf(scope, "graceful shutdown exceeded %s, forcing", timeout)
			closeErr := httpServer.Close()
			if restarting {
				return errRestart
			}
			return closeErr
		}
		logging.Infof(scope, "shut down cleanly")
		if err == nil && restarting {
			return errRestart
		}
		return err
	case received := <-signals:
		logging.Warnf(scope, "received %s again, forcing immediate shutdown", received)
		_ = httpServer.Close()
		return errors.New("forced shutdown")
	}
}

// PrintAgentBanner shows agent mode's effective configuration, and the token
// itself unless it came from the environment, where whoever set it already has
// it. It goes to stdout rather than the leveled log because the operator has
// to read the token off it to register the host.
func PrintAgentBanner(config Config, token string, source httpapi.TokenSource) {
	fmt.Println("")
	fmt.Printf("  Homerun worker %s is running in agent mode (no DATABASE_URL).\n", buildinfo.Version)
	fmt.Printf("  Listening on:   http://0.0.0.0:%d\n", config.Port)
	fmt.Printf("  Docker socket:  %s\n", config.DockerSocketPath)
	switch source {
	case httpapi.TokenFromEnv:
		fmt.Println("  Token source:   WORKER_TOKEN env var")
	case httpapi.TokenGenerated:
		fmt.Printf("  Token source:   generated just now (%s)\n", config.TokenFile)
	default:
		fmt.Printf("  Token source:   persisted (%s)\n", config.TokenFile)
	}
	if source != httpapi.TokenFromEnv {
		fmt.Println("")
		fmt.Printf("  Token:          %s\n", token)
		fmt.Println("  Keep this token secret : it's a full-access credential for this host's Docker daemon.")
	}
	fmt.Println("")
}
