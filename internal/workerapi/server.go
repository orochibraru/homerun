// Package workerapi is the worker's Docker control surface: the HTTP API the
// SvelteKit app calls for everything it used to do against the Docker socket
// itself. The app keeps the database, the business rules and every spec it
// builds; this side owns the socket and does the engine I/O.
//
// Jobs do not come through here. A deploy, a scan, a backup or a cleanup still
// travels through the job table, because a job has to survive either process
// restarting (see the worker note). This API is for what a page is waiting on:
// a status, a preview, a start or stop, and the three things that can't be a
// job at all because they stream — logs, the web terminal and host stats.
package workerapi

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/hoststats"
	"github.com/orochibraru/homerun/internal/httpapi"
)

// Server answers the app's Docker control calls for one daemon.
type Server struct {
	docker    *dockerapi.Client
	stats     *hoststats.StatsSampler
	terminals *TerminalHub
	token     string
}

// NewServer builds the control surface over one daemon and one token. The
// terminal hub's reaper runs for the life of ctx.
func NewServer(ctx context.Context, token string, docker *dockerapi.Client) *Server {
	return &Server{
		docker:    docker,
		stats:     hoststats.NewStatsSampler(),
		terminals: NewTerminalHub(ctx, docker),
		token:     token,
	}
}

// Handler routes every request. /v1/health is open and unlogged, everything
// else needs the bearer token.
func (s *Server) Handler() http.Handler {
	router := chi.NewRouter()
	router.Use(httpapi.RequestLog("/v1/health"))
	router.NotFound(httpapi.NotFound)
	router.MethodNotAllowed(httpapi.MethodNotAllowed)

	router.Get("/v1/health", s.health)

	router.Group(func(r chi.Router) {
		r.Use(httpapi.BearerAuth(s.token))
		s.mountContainers(r)
		s.mountTerminal(r)
		s.mountImages(r)
		s.mountNetworks(r)
		s.mountSystem(r)
		s.mountSwarm(r)
	})
	return router
}

// health answers with the worker's version, so the app can tell a worker
// that's up from one that's merely listening.
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	httpapi.WriteJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": buildinfo.Version,
	})
}
