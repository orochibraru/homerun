package worker

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/logging"
	"github.com/orochibraru/homerun/internal/workerapi"
)

// controlShutdownGrace is how long a shutdown waits for in-flight control
// requests. Short on purpose: unlike a job, nothing here is long-running
// except the streams, and a stream is meant to be cut when the worker stops.
const controlShutdownGrace = 10 * time.Second

// serveControlAPI starts the Docker control API the app calls, and returns the
// function that shuts it down.
//
// It listens before the job loop starts so the app never sees a worker that's
// leasing jobs but refusing control calls. A failure to bind is fatal rather
// than logged and ignored: a worker whose API is down leaves the whole
// dashboard unable to read a container's status, and failing loudly at boot is
// easier to diagnose than every page half-working.
//
// There is deliberately no write timeout on the server. A followed log stream
// and an open terminal are both idle for long stretches, and a write timeout
// would cut them at a fixed interval no matter how healthy they are.
func serveControlAPI(
	ctx context.Context,
	config Config,
	token string,
	docker *dockerapi.Client,
) (func(), error) {
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", config.Port))
	if err != nil {
		return nil, fmt.Errorf("couldn't listen on port %d for the Docker control API: %w", config.Port, err)
	}
	server := &http.Server{
		Handler:           workerapi.NewServer(ctx, token, docker).Handler(),
		ReadHeaderTimeout: 30 * time.Second,
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logging.Errorf(scope, "the Docker control API stopped: %s", err)
		}
	}()
	return func() {
		logging.Debugf(scope, "shutting the Docker control API down")
		shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), controlShutdownGrace)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
		}
	}, nil
}
