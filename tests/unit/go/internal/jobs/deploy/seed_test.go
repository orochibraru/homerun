package deploy_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/zedensix/homerun/internal/jobs"
	"github.com/zedensix/homerun/internal/jobs/deploy"
	"github.com/zedensix/homerun/tests/unit/go/internal/testsupport"
)

type seedDaemon struct {
	fakeDaemon
}

// ServeHTTP answers like fakeDaemon, except the previous container is
// running, the seeded volume doesn't exist yet and a cp helper runs to
// completion over a hijacked attach.
func (d *seedDaemon) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	record := func(call string) {
		d.mu.Lock()
		d.calls = append(d.calls, call)
		d.mu.Unlock()
	}
	switch {
	case r.Method == http.MethodGet && path == "/containers/json":
		record("GET /containers/json")
		_, _ = io.WriteString(w, `[{"Id":"0123456789abcdef","State":"running"}]`)
	case r.Method == http.MethodGet && path == "/services":
		record("GET /services")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"message":"This node is not a swarm manager."}`)
	case r.Method == http.MethodGet && path == "/volumes/homerun-copy":
		record("GET /volumes/homerun-copy")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"message":"no such volume"}`)
	case r.Method == http.MethodPost && path == "/containers/create":
		body, _ := io.ReadAll(r.Body)
		var request struct {
			Cmd []string `json:"Cmd"`
		}
		_ = json.Unmarshal(body, &request)
		if len(request.Cmd) > 0 && request.Cmd[0] == "cp" {
			record("create copy helper")
			_, _ = io.WriteString(w, `{"Id":"helper"}`)
			return
		}
		record("create container")
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		d.fakeDaemon.ServeHTTP(w, r)
	case path == "/containers/helper/attach":
		testsupport.Hijack(w, r, nil)
	case path == "/containers/helper/wait":
		_, _ = io.WriteString(w, `{"StatusCode":0}`)
	default:
		d.fakeDaemon.ServeHTTP(w, r)
	}
}

func TestRunStopsTheServiceAroundASeedCopy(t *testing.T) {
	daemon := &seedDaemon{}
	socket := testsupport.ServeUnixSocket(t, daemon)
	spec := deploy.Spec{
		DeploymentID: "dep",
		Image:        deploy.ImageSpec{Image: "postgres", Kind: "pull", PullPolicy: "always", Tag: "18"},
		Network:      "homerun",
		Readiness:    deploy.ReadinessInput{ContainerPort: 5432},
		Seeds:        []deploy.VolumeSeed{{From: "homerun-original", Image: "alpine:3", Name: "db copy", Source: "homerun-copy"}},
		ServiceID:    "svc",
		Volumes:      []deploy.Volume{{}},
		Workload: deploy.WorkloadSpec{
			ContainerPort: 5432,
			Kind:          "container",
			NamePrefix:    "homerun-db",
			Slug:          "db",
			Template:      map[string]any{},
		},
	}
	job, lines, err := jobs.Recorder("deploy", spec)
	if err != nil {
		t.Fatal(err)
	}
	job.DockerSocket = socket

	if _, err := deploy.Run(context.Background(), job); err != nil {
		t.Fatalf("Run: %s (log %v)", err, lines())
	}
	stop := slices.Index(daemon.calls, "POST /containers/0123456789abcdef/stop")
	copied := slices.Index(daemon.calls, "create copy helper")
	start := slices.Index(daemon.calls, "POST /containers/0123456789abcdef/start")
	created := slices.Index(daemon.calls, "create container")
	if stop < 0 || copied < stop || start < copied || created < start {
		t.Errorf("want stop, copy, start, then the new container, calls %v", daemon.calls)
	}
	log := strings.Join(lines(), "\n")
	if !strings.Contains(log, "Stopped the container 0123456789ab while its volume is copied") || !strings.Contains(log, "Copying db copy into homerun-copy") {
		t.Errorf("log\n%s", log)
	}
}
