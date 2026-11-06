package agent

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/httpapi"
	"github.com/orochibraru/homerun/internal/logging"
	"github.com/orochibraru/homerun/internal/release"
)

// LogLine is one line the agent logged, stamped when it was written.
type LogLine struct {
	Line string    `json:"line"`
	Time time.Time `json:"time"`
}

// LogBuffer keeps the last lines the agent logged, for GET /v1/logs. It is an
// io.Writer for log.SetOutput, next to the process's own stderr.
type LogBuffer struct {
	lines []LogLine
	mu    sync.Mutex
	size  int
}

// NewLogBuffer keeps up to size lines, dropping the oldest first.
func NewLogBuffer(size int) *LogBuffer {
	return &LogBuffer{size: size}
}

// Write records every non-empty line in chunk.
func (b *LogBuffer) Write(chunk []byte) (int, error) {
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	for line := range strings.SplitSeq(strings.TrimRight(string(chunk), "\n"), "\n") {
		if line == "" {
			continue
		}
		b.lines = append(b.lines, LogLine{Line: line, Time: now})
	}
	if overflow := len(b.lines) - b.size; overflow > 0 {
		b.lines = append([]LogLine(nil), b.lines[overflow:]...)
	}
	return len(chunk), nil
}

// Lines is a copy of what's kept, oldest first.
func (b *LogBuffer) Lines() []LogLine {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]LogLine{}, b.lines...)
}

// EventSource is the part of the Docker client GET /v1/events reads.
type EventSource interface {
	Events(ctx context.Context, since time.Time) ([]dockerapi.Event, error)
}

// Admin is the agent's own upkeep surface: its recent log, the host daemon's
// recent events, and replacing its own binary with another release.
type Admin struct {
	Docker     EventSource
	Download   func(version string) (string, error)
	Executable string
	Logs       *LogBuffer
	Restart    func()
}

// eventsWindow is how far back GET /v1/events looks.
const eventsWindow = 24 * time.Hour

// Mount adds the admin routes behind the agent's token.
func (a *Admin) Mount(router chi.Router) {
	router.Get("/v1/logs", httpapi.H(a.logs))
	router.Get("/v1/events", httpapi.H(a.events))
	router.Post("/v1/update", httpapi.H(a.update))
}

// logs answers GET /v1/logs with the kept log lines, oldest first.
func (a *Admin) logs(w http.ResponseWriter, _ *http.Request) error {
	return httpapi.Answer(w, http.StatusOK, map[string]any{"lines": a.Logs.Lines()})
}

// events answers GET /v1/events with the daemon's events of the last day,
// oldest first, as far back as the daemon still holds them.
func (a *Admin) events(w http.ResponseWriter, r *http.Request) error {
	events, err := a.Docker.Events(r.Context(), time.Now().Add(-eventsWindow))
	if err != nil {
		return err
	}
	return httpapi.Answer(w, http.StatusOK, map[string]any{"events": events})
}

// updateInput is POST /v1/update's body.
type updateInput struct {
	Version string `json:"version"`
}

// update downloads the requested release's worker binary, renames it over the
// running one, answers 202, then restarts into it once in-flight requests
// (a build) are done.
func (a *Admin) update(w http.ResponseWriter, r *http.Request) error {
	var input updateInput
	if !httpapi.DecodeJSON(w, r, &input) {
		return nil
	}
	version := strings.TrimPrefix(strings.TrimSpace(input.Version), "v")
	if _, ok := release.ParseVersion(version); !ok {
		return httpapi.Invalid(w, "Invalid request body", []httpapi.ValidationIssue{
			{Message: "version must be a release version like 1.2.3", Path: []string{"version"}},
		})
	}
	staged, err := a.Download(version)
	if err != nil {
		return httpapi.Error(w, http.StatusBadGateway, err.Error())
	}
	if err := os.Rename(staged, a.Executable); err != nil {
		_ = os.Remove(staged)
		return httpapi.Error(w, http.StatusConflict, fmt.Sprintf(
			"Couldn't replace %s (%s): re-run the installer on this host once so the worker owns its binary, then update again.",
			a.Executable, errors.Unwrap(err),
		))
	}
	logging.Infof("update", "replaced v%s with v%s, restarting once in-flight requests finish", buildinfo.Version, version)
	httpapi.WriteJSON(w, http.StatusAccepted, map[string]string{"from": buildinfo.Version, "version": version})
	go a.Restart()
	return nil
}

// ReleaseDownload stages the worker binary of release version for this
// machine's architecture next to executable, returning the staged path.
func ReleaseDownload(executable string) func(version string) (string, error) {
	return func(version string) (string, error) {
		arch, err := release.Arch(runtime.GOARCH)
		if err != nil {
			return "", err
		}
		url := release.AssetURL("v"+version, "homerun-worker-"+arch+".gz")
		client := &http.Client{Timeout: 5 * time.Minute}
		return release.DownloadGzipped(client, url, filepath.Dir(executable))
	}
}
