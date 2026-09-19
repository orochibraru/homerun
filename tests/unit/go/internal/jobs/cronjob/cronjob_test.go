package cronjob_test

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/jobs/cronjob"
)

type fakeDaemon struct {
	mu      sync.Mutex
	created map[string]any
	pulled  string
	killed  bool
	removed bool
	exit    int
	hang    bool
	release chan struct{}
}

// frame wraps text in Docker's multiplexed log framing for the given stream.
func frame(stream byte, text string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
	return append(header, text...)
}

// ServeHTTP answers the fake daemon's canned responses for a cron job run.
func (d *fakeDaemon) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json"):
		w.WriteHeader(http.StatusNotFound)
	case path == "/images/create":
		d.mu.Lock()
		d.pulled = r.URL.Query().Get("fromImage") + ":" + r.URL.Query().Get("tag")
		d.mu.Unlock()
		_, _ = w.Write([]byte(`{"status":"done"}` + "\n"))
	case path == "/containers/create":
		body := map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		d.mu.Lock()
		d.created = body
		d.mu.Unlock()
		_, _ = w.Write([]byte(`{"Id":"c1"}`))
	case path == "/containers/c1/start":
		w.WriteHeader(http.StatusNoContent)
	case path == "/containers/c1/logs":
		_, _ = w.Write(frame(1, "out\n"))
		_, _ = w.Write(frame(2, "err\n"))
		_, _ = w.Write(frame(1, "more\n"))
	case path == "/containers/c1/wait":
		if d.hang {
			<-d.release
		}
		d.mu.Lock()
		code := d.exit
		d.mu.Unlock()
		_, _ = w.Write([]byte(`{"StatusCode":` + strconv.Itoa(code) + `}`))
	case path == "/containers/c1/kill":
		d.mu.Lock()
		d.killed = true
		d.exit = 9
		d.mu.Unlock()
		close(d.release)
		w.WriteHeader(http.StatusNoContent)
	case path == "/containers/c1" && r.Method == http.MethodDelete:
		d.mu.Lock()
		d.removed = true
		d.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusNotImplemented)
	}
}

// serve runs d over a unix socket and returns its path.
func serve(t *testing.T, d *fakeDaemon) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "cj")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(d)
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	return socket
}

// run executes spec against the fake daemon d and returns its result.
func run(t *testing.T, d *fakeDaemon, spec cronjob.Spec) map[string]any {
	t.Helper()
	job, _, err := jobs.Recorder("cron_job", spec)
	if err != nil {
		t.Fatal(err)
	}
	job.DockerSocket = serve(t, d)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := cronjob.Run(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestRunHostCommand(t *testing.T) {
	d := &fakeDaemon{exit: 3}
	result := run(t, d, cronjob.Spec{
		Cmd:            []string{"nsenter", "-t", "1", "--", "sh", "-c", "hostname"},
		Env:            []string{"A=1"},
		Image:          "alpine:3",
		Labels:         map[string]string{"homerun.cronjob.id": "j1"},
		PidMode:        "host",
		Privileged:     true,
		RunID:          "r1",
		TimeoutSeconds: 60,
	})
	if result["exitCode"] != 3 || result["timedOut"] != false || result["output"] != "out\nmore\nerr\n" {
		t.Errorf("result = %v", result)
	}
	if d.pulled != "alpine:3" || !d.removed {
		t.Errorf("pulled = %q removed = %v", d.pulled, d.removed)
	}
	host := d.created["HostConfig"].(map[string]any)
	if host["Privileged"] != true || host["PidMode"] != "host" {
		t.Errorf("HostConfig = %v", host)
	}
	if d.created["Labels"].(map[string]any)["homerun.cronjob.id"] != "j1" {
		t.Errorf("Labels = %v", d.created["Labels"])
	}
}

func TestRunTimeout(t *testing.T) {
	d := &fakeDaemon{hang: true, release: make(chan struct{})}
	result := run(t, d, cronjob.Spec{Image: "busybox:latest", RunID: "r1", TimeoutSeconds: 0})
	if result["timedOut"] != true || result["exitCode"] != 9 || !d.killed {
		t.Errorf("result = %v killed = %v", result, d.killed)
	}
}

func TestRunRejectsSSHRemote(t *testing.T) {
	job, _, _ := jobs.Recorder("cron_job", map[string]any{
		"image": "busybox:latest", "remote": map[string]any{"dockerHost": "ssh://me@box"}, "runId": "r1",
	})
	if _, err := cronjob.Run(context.Background(), job); err == nil {
		t.Error("expected an error for an ssh:// host")
	}
}

func TestTail(t *testing.T) {
	if got := cronjob.Tail("abcdef", 3); got != "def" {
		t.Errorf("tail = %q", got)
	}
	if got := cronjob.Tail("aé", 1); got != "" {
		t.Errorf("tail cut a rune: %q", got)
	}
}
