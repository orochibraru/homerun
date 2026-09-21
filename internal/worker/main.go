// Package worker is the homerun worker: it leases jobs the SvelteKit app has
// prepared (status 'running', stage 'execute') from the shared Postgres job
// table, runs their Go executor, and hands the outcome back for the app to
// finalize. See .agents/notes/worker.md.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/db"
	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/httpapi"
	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/logging"
	"github.com/orochibraru/homerun/internal/secrets"
)

const helpText = `
homerun-worker : executes Homerun's heavy background jobs (deploys, builds,
backups, scans, cron jobs, cleanups) leased from the app's Postgres job queue.

It also serves the Docker control API the app calls for everything it used to
do against the Docker socket itself: container status, start/stop/restart,
logs, the web terminal, host stats, prunes and swarm.

Usage:
  homerun-worker            Start the worker (reads its config from env vars)
  homerun-worker --version  Print the version and exit

Environment:
  DATABASE_URL        The app's Postgres (required)
  AUTH_SECRET         The app's auth secret, which job specs are encrypted with
  DOCKER_SOCKET_PATH  The local Docker socket, auto-detected when unset
  WORKER_CONCURRENCY  Jobs executed at once, 3 by default
  WORKER_ID           Lease owner name, hostname-pid by default
  WORKER_LOG_LEVEL    debug/info/warn/error, else LOG_LEVEL, info by default
  WORKER_PORT         Docker control API port, 7430 by default
  WORKER_TOKEN        Bearer token the app presents, derived from AUTH_SECRET
                      when unset, so no extra configuration is needed
`

// Main runs homerun-worker with the process's own arguments, exiting non-zero on failure.
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
	logging.SetLevelFromEnv()
	if err := run(LoadConfig()); err != nil {
		fmt.Fprintf(os.Stderr, "[homerun-worker] %s\n", err)
		os.Exit(1)
	}
}

// run connects, waits for Postgres, and works until SIGINT/SIGTERM.
func run(config Config) error {
	if config.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	box, err := secrets.New(config.AuthSecret)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, config.DatabaseURL)
	if err != nil {
		return fmt.Errorf("invalid DATABASE_URL: %w", err)
	}
	defer pool.Close()
	if err := waitForDatabase(ctx, pool); err != nil {
		return err
	}

	token := config.ExplicitToken
	source := "WORKER_TOKEN"
	if token == "" {
		token = httpapi.DeriveToken(config.AuthSecret, httpapi.WorkerControlPurpose)
		source = "derived from AUTH_SECRET"
	}
	docker := dockerapi.New(config.DockerSocketPath)
	stopAPI, err := serveControlAPI(ctx, config, token, docker)
	if err != nil {
		return err
	}
	defer stopAPI()

	logging.Infof(scope, "ready: id=%s concurrency=%d docker=%s version=%s",
		config.ID, config.Concurrency, config.DockerSocketPath, buildinfo.Version)
	logging.Infof(scope, "docker control API on :%d (token %s)", config.Port, source)
	logging.Debugf(scope, "executors registered: %s", strings.Join(executorNames(), ", "))
	logging.Debugf(scope, "poll=1s heartbeat=10s lease-timeout=60s shutdown-grace=60s")
	w := &Worker{
		Box:               box,
		Concurrency:       config.Concurrency,
		Executors:         Executors,
		HeartbeatInterval: 10 * time.Second,
		ID:                config.ID,
		PollInterval:      time.Second,
		ShutdownGrace:     60 * time.Second,
		Store:             PGStore{Pool: pool},
	}
	w.NewJob = func(c *ClaimedJob, spec json.RawMessage) jobs.Job {
		return jobs.New(c.ID, c.JobType, c.Attempts, spec, config.DockerSocketPath, pool)
	}
	w.Run(ctx)
	logging.Infof(scope, "stopped")
	return nil
}

// waitForDatabase pings until Postgres answers, so the worker can start
// alongside the database rather than strictly after it.
func waitForDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	logged := false
	for {
		err := pool.Ping(ctx)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !logged {
			logging.Warnf(scope, "waiting for Postgres: %s", err)
			logged = true
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// executorNames lists the job types this worker can execute, for the boot log.
func executorNames() []string {
	names := make([]string, 0, len(Executors))
	for name := range Executors {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
