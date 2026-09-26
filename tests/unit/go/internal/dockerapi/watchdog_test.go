package dockerapi_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/tests/unit/go/internal/testsupport"
)

// fastTimeouts shrinks the control and stall windows for one test.
func fastTimeouts(t *testing.T, control, stall time.Duration) {
	t.Helper()
	oldControl, oldStall := dockerapi.ControlTimeout, dockerapi.StallTimeout
	dockerapi.ControlTimeout, dockerapi.StallTimeout = control, stall
	t.Cleanup(func() { dockerapi.ControlTimeout, dockerapi.StallTimeout = oldControl, oldStall })
}

// engine serves handler as a fake daemon and returns a client pointed at it.
func engine(t *testing.T, handler http.HandlerFunc) *dockerapi.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return dockerapi.NewWithHTTP(server.Client(), server.URL)
}

// hangs blocks until the request is cancelled.
func hangs(_ http.ResponseWriter, r *http.Request) {
	<-r.Context().Done()
}

func TestAControlCallTheDaemonNeverAnswersFailsWithAStall(t *testing.T) {
	fastTimeouts(t, 50*time.Millisecond, time.Second)
	docker := engine(t, hangs)

	started := time.Now()
	_, err := docker.InspectContainer(context.Background(), "abc123")
	var stall *dockerapi.StallError
	if !errors.As(err, &stall) || stall.Container != "abc123" || stall.Call != "GET /containers/abc123/json" {
		t.Fatalf("want a StallError about abc123, got %v", err)
	}
	if !strings.Contains(err.Error(), "stuck on container abc123") || !dockerapi.IsStall(err) {
		t.Errorf("the error must name the container, got %v", err)
	}
	if time.Since(started) > time.Second {
		t.Error("the control timeout must cut the call")
	}
}

func TestAControlCallWhoseBodyNeverEndsFailsWithAStall(t *testing.T) {
	fastTimeouts(t, 50*time.Millisecond, time.Second)
	docker := engine(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"Id":`)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	if _, err := docker.InspectContainer(context.Background(), "abc123"); !dockerapi.IsStall(err) {
		t.Fatalf("a body cut by the deadline is a stall too, got %v", err)
	}
}

func TestTheCallersOwnCancellationIsNotAStall(t *testing.T) {
	fastTimeouts(t, time.Second, time.Second)
	docker := engine(t, hangs)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := docker.InspectContainer(ctx, "abc"); err == nil || dockerapi.IsStall(err) {
		t.Fatalf("the caller's deadline must come back as itself, got %v", err)
	}
}

func TestASilentStreamWhoseContainerIsGoneStalls(t *testing.T) {
	fastTimeouts(t, 50*time.Millisecond, 150*time.Millisecond)
	docker := engine(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/json") {
			hangs(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	logs, err := docker.ContainerLogs(context.Background(), "wedged", true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = logs.Close() }()
	_, err = io.ReadAll(logs)
	var stall *dockerapi.StallError
	if !errors.As(err, &stall) || stall.Container != "wedged" {
		t.Fatalf("want a StallError about the container, got %v", err)
	}
}

func TestASilentStreamWhoseContainerStillRunsKeepsGoing(t *testing.T) {
	fastTimeouts(t, 50*time.Millisecond, 100*time.Millisecond)
	docker := engine(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/json") {
			_, _ = io.WriteString(w, `{"State":{"Running":true}}`)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		time.Sleep(400 * time.Millisecond)
		_, _ = w.Write(testsupport.DockerFrame(1, "done\n"))
	})
	logs, err := docker.ContainerLogs(context.Background(), "quiet", true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = logs.Close() }()
	var out strings.Builder
	if err := dockerapi.Demux(logs, &out); err != nil || out.String() != "done\n" {
		t.Fatalf("a quiet but running container's stream must survive, got %q %v", out.String(), err)
	}
}

func TestAPullThatStopsMovingStalls(t *testing.T) {
	fastTimeouts(t, 50*time.Millisecond, 100*time.Millisecond)
	docker := engine(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"status":"Pulling fs layer"}`+"\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	if err := docker.PullImage(context.Background(), "alpine:3", nil, nil); !dockerapi.IsStall(err) {
		t.Fatalf("a pull with no progress must stall, got %v", err)
	}
}

func TestAStreamThatKeepsMovingHasNoDeadline(t *testing.T) {
	fastTimeouts(t, 50*time.Millisecond, 100*time.Millisecond)
	docker := engine(t, func(w http.ResponseWriter, _ *http.Request) {
		for range 10 {
			_, _ = io.WriteString(w, `{"status":"Downloading"}`+"\n")
			w.(http.Flusher).Flush()
			time.Sleep(40 * time.Millisecond)
		}
	})
	if err := docker.PullImage(context.Background(), "alpine:3", nil, nil); err != nil {
		t.Fatalf("a pull longer than the stall window that keeps moving must finish, got %v", err)
	}
}

func TestHelperLabelsMarkAThrowawayContainer(t *testing.T) {
	labels := dockerapi.HelperLabels(map[string]string{"homerun.volume": "db"})
	created, err := time.Parse(time.RFC3339, labels[dockerapi.HelperCreatedLabel])
	if err != nil || time.Since(created) > time.Minute {
		t.Fatalf("want a creation stamp, got %v", labels)
	}
	if labels[dockerapi.HelperLabel] != "true" || labels[dockerapi.ManagedLabel] != "true" || labels["homerun.volume"] != "db" {
		t.Fatalf("labels = %v", labels)
	}
}
