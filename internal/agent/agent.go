// Package agent is the Homerun Agent: a token-authenticated HTTP control surface for one host's Docker daemon.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/dockersocket"
)

const helpText = `
homerun-agent : token-authenticated HTTP control surface for a remote host's
Docker daemon. See cmd/agent/README.md.

Usage:
  homerun-agent            Start the agent (reads its config from env vars)
  homerun-agent --version  Print the version and exit
`

// Main runs homerun-agent with the process's own arguments, exiting non-zero on failure.
func Main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "-v":
			fmt.Printf("v%s\n", buildinfo.Version)
			return
		case "--help", "-h":
			fmt.Print(helpText)
			return
		}
	}
	log.SetFlags(0)
	if err := run(loadConfig()); err != nil {
		fmt.Fprintf(os.Stderr, "[homerun-agent] %s\n", err)
		os.Exit(1)
	}
}

// run starts the agent and blocks until it's shut down.
func run(config Config) error {
	config.DockerSocketPath = dockersocket.Resolve(config.DockerSocketPath)
	token, source, err := resolveToken(config.ExplicitToken, config.TokenFile)
	if err != nil {
		return fmt.Errorf("couldn't resolve the agent token: %w", err)
	}

	docker := dockerapi.New(config.DockerSocketPath)
	ping, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := docker.Ping(ping); err != nil {
		return fmt.Errorf("Docker isn't reachable at %s: %w", config.DockerSocketPath, err)
	}

	server := NewServer(token, docker, NewBuilder(docker, config.DockerSocketPath), NewStatsSampler())
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", config.Port))
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: server.Handler(), ReadHeaderTimeout: 30 * time.Second}

	printBanner(config, token, source)
	return serveUntilSignalled(httpServer, listener, time.Duration(config.ShutdownTimeoutSeconds)*time.Second)
}

// serveUntilSignalled serves until SIGINT or SIGTERM, then shuts down
// gracefully: no new connections, in-flight requests allowed to finish, since
// killing one could cut a pull or a build off half way. That wait is bounded by
// timeout, and a second signal while waiting forces an immediate exit, the
// usual "one more Ctrl+C to really stop" escape hatch.
func serveUntilSignalled(httpServer *http.Server, listener net.Listener, timeout time.Duration) error {
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	served := make(chan error, 1)
	go func() { served <- httpServer.Serve(listener) }()

	select {
	case err := <-served:
		return err
	case received := <-signals:
		log.Printf("[homerun-agent] received %s, shutting down gracefully (waiting up to %s for any in-flight build to finish)...", received, timeout)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	shutdown := make(chan error, 1)
	go func() { shutdown <- httpServer.Shutdown(ctx) }()

	select {
	case err := <-shutdown:
		if errors.Is(err, context.DeadlineExceeded) {
			log.Printf("[homerun-agent] graceful shutdown exceeded %s, forcing.", timeout)
			return httpServer.Close()
		}
		log.Print("[homerun-agent] shut down cleanly.")
		return err
	case received := <-signals:
		log.Printf("[homerun-agent] received %s again, forcing immediate shutdown.", received)
		_ = httpServer.Close()
		return fmt.Errorf("forced shutdown")
	}
}

// printBanner shows the effective configuration, and the token itself unless it
// came from the environment, where whoever set it already has it.
func printBanner(config Config, token string, source TokenSource) {
	fmt.Println("")
	fmt.Println("  Homerun Agent is running.")
	fmt.Printf("  Listening on:   http://0.0.0.0:%d\n", config.Port)
	fmt.Printf("  Docker socket:  %s\n", config.DockerSocketPath)
	switch source {
	case TokenFromEnv:
		fmt.Println("  Token source:   AGENT_TOKEN env var")
	case TokenGenerated:
		fmt.Printf("  Token source:   generated just now (%s)\n", config.TokenFile)
	default:
		fmt.Printf("  Token source:   persisted (%s)\n", config.TokenFile)
	}
	if source != TokenFromEnv {
		fmt.Println("")
		fmt.Printf("  Agent token:    %s\n", token)
		fmt.Println("  Keep this token secret : it's a full-access credential for this host's Docker daemon.")
	}
	fmt.Println("")
}
