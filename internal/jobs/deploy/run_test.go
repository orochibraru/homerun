package deploy

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/orochibraru/homerun/internal/jobs"
)

type fakeDaemon struct {
	mu       sync.Mutex
	calls    []string
	created  map[string]any
	previous string
}

func (d *fakeDaemon) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	d.calls = append(d.calls, r.Method+" "+r.URL.Path)
	d.mu.Unlock()
	path := r.URL.Path
	switch {
	case r.Method == http.MethodPost && path == "/images/create":
		_, _ = io.WriteString(w, `{"status":"Pulling fs layer","id":"a"}`+"\n"+`{"status":"Pulling fs layer","id":"a"}`+"\n"+`{"status":"Pull complete","id":"a"}`)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/images/"):
		_, _ = io.WriteString(w, `{"Id":"sha256:img","RepoDigests":["nginx@sha256:abc"],"Config":{"Healthcheck":{"Test":["CMD-SHELL","true"]}}}`)
	case r.Method == http.MethodGet && path == "/containers/json":
		_, _ = io.WriteString(w, `[{"Id":"`+d.previous+`","State":"exited"}]`)
	case r.Method == http.MethodPost && path == "/networks/create":
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"message":"network exists"}`)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/connect"):
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodPost && path == "/containers/create":
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		d.mu.Lock()
		d.created = body
		d.mu.Unlock()
		_, _ = io.WriteString(w, `{"Id":"new-container"}`)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func startFakeDaemon(t *testing.T, daemon http.Handler) string {
	dir, err := os.MkdirTemp("/tmp", "hrdk")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(daemon)
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	return socket
}

func TestRunPullsAndReplacesTheContainer(t *testing.T) {
	daemon := &fakeDaemon{previous: "old-container"}
	socket := startFakeDaemon(t, daemon)
	spec := Spec{
		DeploymentID: "dep",
		Env:          [][2]string{{"A", "1"}},
		Healthchecks: Healthchecks{Listening: map[string]any{"Test": []string{"CMD-SHELL", "listen"}}},
		Image:        ImageSpec{Image: "nginx", Kind: "pull", PullPolicy: "always", Tag: "alpine"},
		Network:      "homerun",
		Readiness:    ReadinessInput{ContainerPort: 80, Routed: true},
		ServiceID:    "svc",
		Workload: WorkloadSpec{
			ContainerPort: 80,
			Kind:          "container",
			NamePrefix:    "homerun-web",
			Slug:          "web",
			StackNetwork:  "homerun-stack-1",
			Template:      map[string]any{"Labels": map[string]any{"homerun.service.id": "svc"}, "Tty": true},
		},
	}
	job, lines, err := jobs.Recorder("deploy", spec)
	if err != nil {
		t.Fatal(err)
	}
	job.DockerSocket = socket

	result, err := Run(context.Background(), job)
	if err != nil {
		t.Fatalf("Run: %s (log %v)", err, lines())
	}
	if result["containerId"] != "new-container" || result["imageId"] != "sha256:img" || result["digest"] != "sha256:abc" {
		t.Errorf("result %v", result)
	}
	scans, _ := result["scans"].([]any)
	if len(scans) != 1 || scans[0].(map[string]any)["status"] != "skipped" {
		t.Errorf("a scan-less deploy records a skipped scan, got %v", scans)
	}
	want := []string{
		"Pulling nginx:alpine...",
		"Pulling fs layer: a",
		"Pull complete: a",
		phaseContainer,
		"Readiness: the image's own HEALTHCHECK must pass before the new container gets traffic.",
		"Removing the previous container...",
		"Creating container...",
		"Starting container...",
		"Reachable at web:80 from other services.",
		phaseNetwork,
	}
	if got := lines(); !slices.Equal(got, want) {
		t.Errorf("log\n got %q\nwant %q", got, want)
	}
	if daemon.created["Image"] != "nginx:alpine" || !slices.Equal(anyStrings(daemon.created["Env"]), []string{"A=1"}) {
		t.Errorf("created %v", daemon.created)
	}
	if _, ok := daemon.created["Healthcheck"]; ok {
		t.Error("the image's own healthcheck is kept")
	}
	if !slices.Contains(daemon.calls, "POST /networks/homerun-stack-1/connect") || !slices.Contains(daemon.calls, "DELETE /containers/old-container") {
		t.Errorf("calls %v", daemon.calls)
	}
}

func anyStrings(value any) []string {
	list, _ := value.([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		text, _ := item.(string)
		out = append(out, text)
	}
	return out
}
