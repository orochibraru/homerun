package workerapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/httpapi"
)

// mountNetworks wires the network and volume routes.
func (s *Server) mountNetworks(r chi.Router) {
	r.Get("/v1/networks", httpapi.H(s.listNetworks))
	r.Post("/v1/networks", httpapi.H(s.createNetwork))
	r.Delete("/v1/networks/{id}", httpapi.H(s.removeNetwork))
	r.Get("/v1/volumes", httpapi.H(s.listVolumes))
	r.Delete("/v1/volumes/{name}", httpapi.H(s.removeVolume))
}

// mountSystem wires the daemon-wide routes: info, disk usage, prunes and this
// host's own resource usage.
func (s *Server) mountSystem(r chi.Router) {
	r.Get("/v1/info", httpapi.H(s.systemInfo))
	r.Get("/v1/df", httpapi.H(s.diskUsage))
	r.Get("/v1/host/stats", httpapi.H(s.hostStats))
	r.Post("/v1/prune/{kind}", httpapi.H(s.prune))
	r.Post("/v1/one-off", httpapi.H(s.runOneOff))
}

// listNetworks answers with every network on the daemon.
func (s *Server) listNetworks(w http.ResponseWriter, r *http.Request) error {
	networks, err := s.docker.NetworkList(r.Context())
	if err != nil {
		return err
	}
	if networks == nil {
		networks = []dockerapi.Network{}
	}
	return httpapi.Answer(w, http.StatusOK, networks)
}

// createNetwork creates a network from the app's own Engine create body,
// treating one that already exists as success.
func (s *Server) createNetwork(w http.ResponseWriter, r *http.Request) error {
	var body map[string]any
	if !httpapi.DecodeJSON(w, r, &body) {
		return nil
	}
	if body["Name"] == nil {
		return httpapi.Invalid(w, "Invalid request body",
			[]httpapi.ValidationIssue{{Message: "Name is required", Path: []string{"Name"}}})
	}
	created, err := s.docker.EnsureNetwork(r.Context(), body)
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"created": created})
}

// removeNetwork removes a network. One already gone isn't an error: a prune
// may well have taken it, and the caller only wants it absent.
func (s *Server) removeNetwork(w http.ResponseWriter, r *http.Request) error {
	_ = s.docker.NetworkRemove(r.Context(), chi.URLParam(r, "id"))
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// listVolumes answers with every volume on the daemon.
func (s *Server) listVolumes(w http.ResponseWriter, r *http.Request) error {
	volumes, err := s.docker.ListVolumes(r.Context())
	if err != nil {
		return err
	}
	if volumes == nil {
		volumes = []dockerapi.Volume{}
	}
	return httpapi.Answer(w, http.StatusOK, volumes)
}

// removeVolume removes one volume.
func (s *Server) removeVolume(w http.ResponseWriter, r *http.Request) error {
	if err := s.docker.RemoveVolume(r.Context(), chi.URLParam(r, "name")); err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// systemInfo answers with `docker info`.
func (s *Server) systemInfo(w http.ResponseWriter, r *http.Request) error {
	info, err := s.docker.SystemInfo(r.Context())
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, info)
}

// diskUsage answers with `docker system df`, which backs the Docker Cleanup
// page's preview of what each prune would reclaim.
func (s *Server) diskUsage(w http.ResponseWriter, r *http.Request) error {
	usage, err := s.docker.SystemDiskUsage(r.Context())
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, usage)
}

// hostStats answers with this host's CPU, memory, disk and GPU usage.
//
// The worker serves it because the worker is the process that actually runs on
// the Docker host: the app may well be in a container whose /proc is its own,
// which would have it reporting the container's limits as the machine's.
func (s *Server) hostStats(w http.ResponseWriter, _ *http.Request) error {
	return httpapi.Answer(w, http.StatusOK, s.stats.Sample())
}

// prune runs one of the daemon's prune endpoints by name.
//
// The keep-list prunes (images and volumes the app wants spared) aren't here:
// the daemon can only filter a prune by label, so those run as a Docker
// Cleanup job that deletes item by item, and they need the database to know
// what to keep.
func (s *Server) prune(w http.ResponseWriter, r *http.Request) error {
	var report dockerapi.PruneReport
	var err error
	switch kind := chi.URLParam(r, "kind"); kind {
	case "containers":
		report, err = s.docker.PruneContainers(r.Context())
	case "images":
		report, err = s.docker.PruneImages(r.Context(), r.URL.Query().Get("all") == "1")
	case "networks":
		report, err = s.docker.PruneNetworks(r.Context())
	case "build-cache":
		report, err = s.docker.PruneBuildCache(r.Context())
	case "volumes":
		report, err = s.docker.PruneVolumes(r.Context())
	default:
		return httpapi.Invalid(w, "Invalid request", []httpapi.ValidationIssue{
			{Message: "kind must be one of containers, images, networks, build-cache, volumes", Path: []string{"kind"}},
		})
	}
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]any{
		"itemsDeleted":   report.Deleted,
		"spaceReclaimed": report.SpaceReclaimed,
	})
}

// runOneOff runs a throwaway container to completion and answers with its
// output, for the places that need a container as a tool rather than as a
// service: reading a named volume out for a backup, running a user's cron job.
func (s *Server) runOneOff(w http.ResponseWriter, r *http.Request) error {
	var config dockerapi.OneOffConfig
	if !httpapi.DecodeJSON(w, r, &config) {
		return nil
	}
	if config.Image == "" {
		return httpapi.Invalid(w, "Invalid request body",
			[]httpapi.ValidationIssue{{Message: "Image is required", Path: []string{"Image"}}})
	}
	result, err := s.docker.RunOneOff(r.Context(), config)
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, result)
}
