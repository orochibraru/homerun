package deploy_test

import (
	"context"
	"encoding/json"
	"github.com/orochibraru/homerun/tests/unit/go/internal/testsupport"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/jobs/deploy"
)

type fakeDaemon struct {
	mu       sync.Mutex
	calls    []string
	created  map[string]any
	previous string
}

// ServeHTTP answers the fake daemon's canned responses for a deploy.
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

func TestRunPullsAndReplacesTheContainer(t *testing.T) {
	daemon := &fakeDaemon{previous: "old-container"}
	socket := testsupport.ServeUnixSocket(t, daemon)
	spec := deploy.Spec{
		DeploymentID: "dep",
		Env:          [][2]string{{"A", "1"}},
		Healthchecks: deploy.Healthchecks{Listening: map[string]any{"Test": []string{"CMD-SHELL", "listen"}}},
		Image:        deploy.ImageSpec{Image: "nginx", Kind: "pull", PullPolicy: "always", Tag: "alpine"},
		Network:      "homerun",
		Readiness:    deploy.ReadinessInput{ContainerPort: 80, Routed: true},
		ServiceID:    "svc",
		Workload: deploy.WorkloadSpec{
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

	result, err := deploy.Run(context.Background(), job)
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
		deploy.PhaseContainer,
		"Readiness: the image's own HEALTHCHECK must pass before the new container gets traffic.",
		"Removing the previous container...",
		"Creating container...",
		"Starting container...",
		"Reachable at web:80 from other services.",
		deploy.PhaseNetwork,
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

// anyStrings converts a []any of strings (as decoded from JSON) to []string.
func anyStrings(value any) []string {
	list, _ := value.([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		text, _ := item.(string)
		out = append(out, text)
	}
	return out
}
