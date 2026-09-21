package workerapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/httpapi"
)

// defaultLogTail is how many lines a log stream starts from when the caller
// doesn't say, matching what the Logs tab asked dockerode for.
const defaultLogTail = 200

// readinessLabel marks the healthcheck Homerun generates itself, which the
// health endpoint hides: it's this app's own readiness gate, not something the
// image's author declared, so reporting it as "the service has a healthcheck"
// would be a lie.
const readinessLabel = "homerun.readiness"

// mountContainers wires the container routes.
func (s *Server) mountContainers(r chi.Router) {
	r.Get("/v1/containers", httpapi.H(s.listContainers))
	r.Post("/v1/containers", httpapi.H(s.createContainer))
	r.Post("/v1/containers/{id}/start", httpapi.H(s.startContainer))
	r.Post("/v1/containers/{id}/stop", httpapi.H(s.stopContainer))
	r.Post("/v1/containers/{id}/restart", httpapi.H(s.restartContainer))
	r.Delete("/v1/containers/{id}", httpapi.H(s.removeContainer))
	r.Get("/v1/containers/{id}/status", httpapi.H(s.containerStatus))
	r.Get("/v1/containers/{id}/health", httpapi.H(s.containerHealth))
	r.Get("/v1/containers/{id}/address", httpapi.H(s.containerAddress))
	r.Get("/v1/containers/{id}/inspect", httpapi.H(s.inspectContainer))
	r.Get("/v1/containers/{id}/stats", httpapi.H(s.containerStats))
	r.Get("/v1/containers/{id}/logs", httpapi.H(s.containerLogs))
	r.Put("/v1/containers/{id}/archive", httpapi.H(s.putArchive))
	r.Post("/v1/containers/{id}/connect", httpapi.H(s.connectContainer))
	r.Post("/v1/exec", httpapi.H(s.runExec))
}

// containerStatusFrom maps a container's inspected state onto the status the
// dashboard shows. A direct port of the TypeScript containerStateToStatus: a
// container that exited cleanly reads as stopped, one that exited non-zero as
// failed, and anything unrecognised as stopped rather than as an error.
func containerStatusFrom(state string, exitCode int) string {
	switch state {
	case "running":
		return "running"
	case "created", "restarting":
		return "starting"
	case "exited", "dead":
		if exitCode == 0 {
			return "stopped"
		}
		return "failed"
	default:
		return "stopped"
	}
}

// listContainers answers with the daemon's container list, optionally
// including stopped ones and filtered to one label.
func (s *Server) listContainers(w http.ResponseWriter, r *http.Request) error {
	all := r.URL.Query().Get("all") == "1"
	containers, err := s.docker.ListContainers(r.Context(), all, r.URL.Query().Get("label"))
	if err != nil {
		return err
	}
	if containers == nil {
		containers = []dockerapi.ContainerListEntry{}
	}
	return httpapi.Answer(w, http.StatusOK, containers)
}

// createContainerBody is a create request: the whole Engine create body the
// app built, plus the name to give it.
type createContainerBody struct {
	Body map[string]any `json:"body"`
	Name string         `json:"name"`
}

// createContainer creates a container from the app's own Engine create body.
func (s *Server) createContainer(w http.ResponseWriter, r *http.Request) error {
	var input createContainerBody
	if !httpapi.DecodeJSON(w, r, &input) {
		return nil
	}
	if input.Body == nil {
		return httpapi.Invalid(w, "Invalid request body",
			[]httpapi.ValidationIssue{{Message: "body is required", Path: []string{"body"}}})
	}
	id, err := s.docker.CreateContainerFrom(r.Context(), input.Name, input.Body)
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]string{"id": id})
}

// startContainer starts a container. One already running isn't an error.
func (s *Server) startContainer(w http.ResponseWriter, r *http.Request) error {
	if err := s.docker.EnsureContainerStarted(r.Context(), chi.URLParam(r, "id")); err != nil {
		return notFoundOr(w, err)
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// stopContainer stops a container. One already stopped isn't an error.
func (s *Server) stopContainer(w http.ResponseWriter, r *http.Request) error {
	if err := s.docker.StopContainer(r.Context(), chi.URLParam(r, "id")); err != nil {
		return notFoundOr(w, err)
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// restartContainer restarts a container.
func (s *Server) restartContainer(w http.ResponseWriter, r *http.Request) error {
	if err := s.docker.ContainerRestart(r.Context(), chi.URLParam(r, "id")); err != nil {
		return notFoundOr(w, err)
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// removeContainer removes a container, forcing a running one only when asked.
func (s *Server) removeContainer(w http.ResponseWriter, r *http.Request) error {
	force := r.URL.Query().Get("force") == "1"
	if err := s.docker.RemoveContainerOpts(r.Context(), chi.URLParam(r, "id"), force); err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// containerStatus answers with the dashboard status for a container.
//
// A container the daemon has never heard of reads as "missing", which is a
// real state the Errors tab acts on (something removed it outside this app),
// and is deliberately distinct from "failed", where the container is still
// there and exited badly. Any other inspect failure keeps the old behaviour
// and reads as "failed".
func (s *Server) containerStatus(w http.ResponseWriter, r *http.Request) error {
	inspected, err := s.docker.InspectContainer(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, dockerapi.ErrNotFound) {
		return httpapi.Answer(w, http.StatusOK, map[string]string{"status": "missing"})
	}
	if err != nil {
		return httpapi.Answer(w, http.StatusOK, map[string]string{"status": "failed"})
	}
	status := containerStatusFrom(inspected.State.Status, inspected.State.ExitCode)
	return httpapi.Answer(w, http.StatusOK, map[string]string{"status": status})
}

// containerHealth answers with the container's own healthcheck verdict, or
// null when it has none, only has Homerun's generated readiness check, or
// can't be inspected at all.
func (s *Server) containerHealth(w http.ResponseWriter, r *http.Request) error {
	inspected, err := s.docker.InspectRaw(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return httpapi.Answer(w, http.StatusOK, nil)
	}
	if labels := nestedMap(inspected, "Config", "Labels"); labels != nil {
		if _, generated := labels[readinessLabel]; generated {
			return httpapi.Answer(w, http.StatusOK, nil)
		}
	}
	health := nestedMap(inspected, "State", "Health")
	status, _ := health["Status"].(string)
	if status == "" {
		return httpapi.Answer(w, http.StatusOK, nil)
	}
	var output any
	if entries, ok := health["Log"].([]any); ok && len(entries) > 0 {
		if last, ok := entries[len(entries)-1].(map[string]any); ok {
			output = last["Output"]
		}
	}
	return httpapi.Answer(w, http.StatusOK, map[string]any{"output": output, "status": status})
}

// containerAddress answers with the first IP address the container holds on
// any network, for the uptime probe to reach it directly.
func (s *Server) containerAddress(w http.ResponseWriter, r *http.Request) error {
	inspected, err := s.docker.InspectRaw(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return httpapi.Answer(w, http.StatusOK, map[string]any{"address": nil})
	}
	networks := nestedMap(inspected, "NetworkSettings", "Networks")
	for _, entry := range networks {
		settings, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if address, ok := settings["IPAddress"].(string); ok && address != "" {
			return httpapi.Answer(w, http.StatusOK, map[string]any{"address": address})
		}
	}
	return httpapi.Answer(w, http.StatusOK, map[string]any{"address": nil})
}

// inspectContainer answers with the daemon's whole inspect body, for the
// callers that rebuild a container from its own config.
func (s *Server) inspectContainer(w http.ResponseWriter, r *http.Request) error {
	inspected, err := s.docker.InspectRaw(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, dockerapi.ErrNotFound) {
		return httpapi.Error(w, http.StatusNotFound, "No such container.")
	}
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, inspected)
}

// containerStats answers with one resource sample, or null for a container the
// daemon can't stat: a stats panel with one blank row beats a failed page.
func (s *Server) containerStats(w http.ResponseWriter, r *http.Request) error {
	sample, err := s.docker.ContainerStats(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return httpapi.Answer(w, http.StatusOK, nil)
	}
	return httpapi.Answer(w, http.StatusOK, sample)
}

// containerLogs streams a container's combined output as plain text, following
// it unless the caller asked for a one-shot tail.
//
// The daemon frames stdout and stderr separately for a non-TTY container, so
// the frame headers are stripped here rather than being passed on for the app
// to decode: a log line is a log line by the time it leaves the worker.
func (s *Server) containerLogs(w http.ResponseWriter, r *http.Request) error {
	follow := r.URL.Query().Get("follow") != "0"
	logs, err := s.docker.ContainerLogsStream(r.Context(), chi.URLParam(r, "id"), tailParam(r), follow)
	if errors.Is(err, dockerapi.ErrNotFound) {
		return httpapi.Error(w, http.StatusNotFound, "No such container.")
	}
	if err != nil {
		return err
	}
	defer func() { _ = logs.Close() }()
	return streamOut(w, r, logs)
}

// putArchive unpacks a tar stream into a path inside a container, which is how
// a file is written into a Docker-managed volume without the app ever touching
// the host filesystem.
func (s *Server) putArchive(w http.ResponseWriter, r *http.Request) error {
	path := r.URL.Query().Get("path")
	if path == "" {
		return httpapi.Invalid(w, "Invalid query",
			[]httpapi.ValidationIssue{{Message: "path is required", Path: []string{"path"}}})
	}
	if err := s.docker.PutContainerArchive(r.Context(), chi.URLParam(r, "id"), path, r.Body); err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// connectContainerBody names the network to attach a container to, and the DNS
// aliases it should answer to on it.
type connectContainerBody struct {
	Aliases []string `json:"aliases"`
	Network string   `json:"network"`
}

// connectContainer attaches a container to a network under its aliases.
func (s *Server) connectContainer(w http.ResponseWriter, r *http.Request) error {
	var input connectContainerBody
	if !httpapi.DecodeJSON(w, r, &input) {
		return nil
	}
	if input.Network == "" {
		return httpapi.Invalid(w, "Invalid request body",
			[]httpapi.ValidationIssue{{Message: "network is required", Path: []string{"network"}}})
	}
	err := s.docker.ConnectNetwork(r.Context(), input.Network, chi.URLParam(r, "id"), input.Aliases)
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]bool{"ok": true})
}

// execBody is a one-shot command to run inside a running container.
type execBody struct {
	Cmd       []string `json:"cmd"`
	Container string   `json:"container"`
}

// runExec runs a command in a running container and answers with its exit code
// and output. Non-interactive: an interactive shell is a terminal session.
func (s *Server) runExec(w http.ResponseWriter, r *http.Request) error {
	var input execBody
	if !httpapi.DecodeJSON(w, r, &input) {
		return nil
	}
	if input.Container == "" || len(input.Cmd) == 0 {
		return httpapi.Invalid(w, "Invalid request body", []httpapi.ValidationIssue{
			{Message: "container and cmd are required", Path: []string{}},
		})
	}
	result, err := s.docker.ContainerExec(r.Context(), input.Container, input.Cmd)
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]any{
		"exitCode": result.ExitCode,
		"stderr":   result.Stderr,
		"stdout":   result.Stdout,
	})
}

// tailParam reads ?tail=, falling back to defaultLogTail.
func tailParam(r *http.Request) int {
	raw := r.URL.Query().Get("tail")
	if raw == "" {
		return defaultLogTail
	}
	tail, err := strconv.Atoi(raw)
	if err != nil || tail < 0 {
		return defaultLogTail
	}
	return tail
}

// streamOut demuxes a Docker frame stream into the response as plain text,
// flushing as it goes so a follower sees each line when it happens rather than
// when Go's buffer fills.
func streamOut(w http.ResponseWriter, r *http.Request, source io.Reader) error {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(noDeadline)
	writer := &flushWriter{controller: controller, writer: w}
	if err := dockerapi.DemuxAuto(source, writer); err != nil && r.Context().Err() == nil {
		return err
	}
	return nil
}

// notFoundOr answers a missing container as a 404 and reports anything else as
// a real failure.
func notFoundOr(w http.ResponseWriter, err error) error {
	if errors.Is(err, dockerapi.ErrNotFound) {
		return httpapi.Error(w, http.StatusNotFound, "No such container.")
	}
	return err
}

// nestedMap walks a decoded inspect body down a path of object keys, returning
// nil as soon as one is missing or isn't an object.
func nestedMap(root map[string]any, path ...string) map[string]any {
	current := root
	for _, key := range path {
		next, ok := current[key].(map[string]any)
		if !ok {
			return nil
		}
		current = next
	}
	return current
}
