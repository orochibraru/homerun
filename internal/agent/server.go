package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/dockerapi"
)

// Server is the agent's HTTP control surface: /v1/health and /v1/openapi.json
// are open, every other route needs the bearer token.
type Server struct {
	builder *Builder
	docker  Docker
	stats   *StatsSampler
	token   string
}

// NewServer builds the server for one daemon and one token.
func NewServer(token string, docker Docker, builder *Builder, stats *StatsSampler) *Server {
	return &Server{builder: builder, docker: docker, stats: stats, token: token}
}

// Handler routes every request. /v1/health isn't logged: a monitor or the
// Remote Hosts page polls it every few seconds, which would drown everything
// else out.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", s.health)
	mux.HandleFunc("GET /v1/openapi.json", s.openAPI)
	mux.Handle("GET /v1/stats", s.authed(s.statsRoute))
	mux.Handle("POST /v1/build", s.authed(s.build))
	mux.Handle("GET /v1/images/save", s.authed(s.saveImage))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// answer writes a JSON response for a request the route has fully handled,
// such as a refused body, so there's no error left for authed to report.
func answer(w http.ResponseWriter, status int, body any) error {
	writeJSON(w, status, body)
	return nil
}

// handlerFunc is a route that reports its failures as an error, turned into a
// 500 with the message by authed.
type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// statusRecorder remembers the status a handler wrote, for the request log.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// authed wraps a route with the bearer-token check, a log line per request
// and the shared error-to-500 translation, so a request that reached the agent
// and did real work always leaves a trace in its own log.
func (s *Server) authed(handler handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		if !s.checkAuth(r) {
			log.Printf("[http] %s %s - 401", r.Method, r.URL.Path)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		if err := handler(recorder, r); err != nil {
			log.Printf("[http] %s %s - 500 (%dms): %s", r.Method, r.URL.Path, time.Since(start).Milliseconds(), err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		log.Printf("[http] %s %s - %d (%dms)", r.Method, r.URL.Path, recorder.status, time.Since(start).Milliseconds())
	})
}

// checkAuth reports whether the request carries a Bearer token matching the
// agent's own, compared in constant time.
func (s *Server) checkAuth(r *http.Request) bool {
	presented, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return ok && presented != "" && tokensMatch(presented, s.token)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": buildinfo.Version})
}

func (s *Server) openAPI(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	writeJSON(w, http.StatusOK, openAPIDocument(fmt.Sprintf("%s://%s", scheme, r.Host)))
}

func (s *Server) statsRoute(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, s.stats.Sample())
	return nil
}

// build runs POST /v1/build. The whole build happens inside the request and
// answers with one JSON result: 200 when it succeeded, 500 when it didn't.
func (s *Server) build(w http.ResponseWriter, r *http.Request) error {
	var input BuildInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		return answer(w, http.StatusBadRequest, map[string]any{
			"error":  "Invalid request body",
			"issues": []validationIssue{{Message: "the body isn't valid JSON", Path: []string{}}},
		})
	}
	if issues := validateBuildInput(input); len(issues) > 0 {
		return answer(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body", "issues": issues})
	}
	result := s.builder.Build(r.Context(), input)
	status := http.StatusOK
	if !result.Success {
		status = http.StatusInternalServerError
	}
	writeJSON(w, status, result)
	return nil
}

// saveImage streams a local image as a `docker save` tarball, for the main app
// to load onto its own daemon when a build has no cache registry to publish
// through.
func (s *Server) saveImage(w http.ResponseWriter, r *http.Request) error {
	ref := r.URL.Query().Get("ref")
	if ref == "" {
		return answer(w, http.StatusBadRequest, map[string]any{
			"error":  "Invalid query",
			"issues": []validationIssue{{Message: "ref is required", Path: []string{"ref"}}},
		})
	}
	archive, err := s.docker.SaveImage(r.Context(), ref)
	if errors.Is(err, dockerapi.ErrNotFound) {
		return answer(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Image %s not found.", ref)})
	}
	if err != nil {
		return err
	}
	defer func() { _ = archive.Close() }()
	log.Printf("[save] %s", ref)
	w.Header().Set("Content-Type", "application/x-tar")
	w.WriteHeader(http.StatusOK)
	if _, copyErr := io.Copy(w, archive); copyErr != nil {
		log.Printf("[save] %s: the stream ended early: %s", ref, copyErr)
	}
	return nil
}

// validationIssue is one reason a request body was refused.
type validationIssue struct {
	Message string   `json:"message"`
	Path    []string `json:"path"`
}

var commitPattern = regexp.MustCompile(`(?i)^[0-9a-f]{40}$`)

// validateBuildInput checks a build request the way the TypeScript agent's zod
// schema did, returning one issue per problem so a malformed request fails as
// a clean 400 instead of deep inside a docker call.
func validateBuildInput(input BuildInput) []validationIssue {
	issues := []validationIssue{}
	add := func(message string, path ...string) {
		issues = append(issues, validationIssue{Message: message, Path: path})
	}
	if input.GitURL == "" {
		add("gitUrl is required", "gitUrl")
	}
	if input.Tag == "" {
		add("tag is required", "tag")
	}
	if input.Commit != nil && *input.Commit != "" && !commitPattern.MatchString(*input.Commit) {
		add("commit must be a full 40-character SHA", "commit")
	}
	if input.BuildMethod != nil && *input.BuildMethod != "" && !isBuildMethod(*input.BuildMethod) {
		add(fmt.Sprintf("buildMethod must be one of %s", strings.Join(tools.BuildMethods, ", ")), "buildMethod")
	}
	if input.BakeTarget != nil && *input.BakeTarget != "" && !bakeTargetPattern.MatchString(*input.BakeTarget) {
		add("bakeTarget must be a plain target name", "bakeTarget")
	}
	if input.Credential != nil && input.Credential.Token == "" {
		add("credential.token is required", "credential", "token")
	}
	if input.Push != nil {
		if input.Push.RegistryURL == "" {
			add("push.registryUrl is required", "push", "registryUrl")
		}
		if input.Push.Tag == "" {
			add("push.tag is required", "push", "tag")
		}
	}
	return issues
}
