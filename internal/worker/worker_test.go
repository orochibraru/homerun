package worker

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/jobs"
	"github.com/orochibraru/homerun/internal/secrets"
)

type outcome struct {
	err    error
	id     string
	result map[string]any
}

type fakeStore struct {
	mu        sync.Mutex
	queue     []*claimed
	finished  []outcome
	released  []string
	leaseLost bool
}

func (s *fakeStore) claim(context.Context, string) (*claimed, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queue) == 0 {
		return nil, nil
	}
	next := s.queue[0]
	s.queue = s.queue[1:]
	return next, nil
}

func (s *fakeStore) heartbeat(context.Context, string, string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.leaseLost, nil
}

func (s *fakeStore) finish(_ context.Context, id, _ string, result map[string]any, err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finished = append(s.finished, outcome{err: err, id: id, result: result})
	return nil
}

func (s *fakeStore) release(_ context.Context, id, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.released = append(s.released, id)
	return nil
}

func testWorker(t *testing.T, store *fakeStore, executors map[string]Executor) *worker {
	t.Helper()
	box, err := secrets.New("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	return &worker{
		box:               box,
		concurrency:       2,
		executors:         executors,
		heartbeatInterval: 5 * time.Millisecond,
		id:                "test-worker",
		newJob: func(c *claimed, spec json.RawMessage) jobs.Job {
			return jobs.New(c.id, c.jobType, c.attempts, spec, "", nil)
		},
		pollInterval:  5 * time.Millisecond,
		shutdownGrace: 50 * time.Millisecond,
		store:         store,
	}
}

func sealed(t *testing.T, spec string) string {
	t.Helper()
	box, _ := secrets.New("test-secret")
	out, err := box.Encrypt(spec)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func runUntil(t *testing.T, w *worker, done func() bool) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		w.run(ctx)
		close(stopped)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for !done() && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
	<-stopped
}

func TestExecutesAndHandsTheResultBack(t *testing.T) {
	store := &fakeStore{queue: []*claimed{{attempts: 1, id: "j1", jobType: "echo", spec: sealed(t, `{"name":"web"}`)}}}
	w := testWorker(t, store, map[string]Executor{
		"echo": func(_ context.Context, job jobs.Job) (map[string]any, error) {
			var spec struct{ Name string }
			if err := job.DecodeSpec(&spec); err != nil {
				return nil, err
			}
			return map[string]any{"name": spec.Name, "job": job.ID}, nil
		},
	})
	runUntil(t, w, func() bool { store.mu.Lock(); defer store.mu.Unlock(); return len(store.finished) == 1 })

	got := store.finished[0]
	if got.err != nil || got.result["name"] != "web" || got.result["job"] != "j1" {
		t.Errorf("unexpected outcome %+v", got)
	}
}

func TestExecutorFailuresAreRecordedNotFatal(t *testing.T) {
	store := &fakeStore{queue: []*claimed{
		{id: "unknown", jobType: "nope", spec: sealed(t, `{}`)},
		{id: "garbled", jobType: "boom", spec: "not.a.spec"},
		{id: "panics", jobType: "panic", spec: sealed(t, `{}`)},
		{id: "fails", jobType: "boom", spec: sealed(t, `{}`)},
	}}
	w := testWorker(t, store, map[string]Executor{
		"boom":  func(context.Context, jobs.Job) (map[string]any, error) { return nil, errors.New("pull failed") },
		"panic": func(context.Context, jobs.Job) (map[string]any, error) { panic("kaboom") },
	})
	runUntil(t, w, func() bool { store.mu.Lock(); defer store.mu.Unlock(); return len(store.finished) == 4 })

	errs := map[string]string{}
	for _, o := range store.finished {
		if o.err == nil {
			t.Fatalf("%s should have failed", o.id)
		}
		errs[o.id] = o.err.Error()
	}
	want := map[string]string{
		"unknown": `the worker has no executor for job type "nope"`,
		"fails":   "pull failed",
		"panics":  "executor panicked: kaboom",
	}
	for id, message := range want {
		if errs[id] != message {
			t.Errorf("%s: want %q, got %q", id, message, errs[id])
		}
	}
	if errs["garbled"] == "" {
		t.Error("an undecryptable spec fails the execution")
	}
}

func TestLostLeaseCancelsAndDropsTheResult(t *testing.T) {
	store := &fakeStore{leaseLost: true, queue: []*claimed{{id: "j1", jobType: "slow", spec: sealed(t, `{}`)}}}
	cancelled := make(chan struct{})
	w := testWorker(t, store, map[string]Executor{
		"slow": func(ctx context.Context, _ jobs.Job) (map[string]any, error) {
			<-ctx.Done()
			close(cancelled)
			return nil, ctx.Err()
		},
	})
	runUntil(t, w, func() bool {
		select {
		case <-cancelled:
			return true
		default:
			return false
		}
	})
	if len(store.finished) != 0 || len(store.released) != 0 {
		t.Errorf("a job leased elsewhere must not be written to, got %+v / %v", store.finished, store.released)
	}
}

func TestShutdownReleasesJobsThatOutliveTheGrace(t *testing.T) {
	store := &fakeStore{queue: []*claimed{{id: "j1", jobType: "slow", spec: sealed(t, `{}`)}}}
	started := make(chan struct{})
	w := testWorker(t, store, map[string]Executor{
		"slow": func(ctx context.Context, _ jobs.Job) (map[string]any, error) {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		},
	})
	runUntil(t, w, func() bool {
		select {
		case <-started:
			return true
		default:
			return false
		}
	})
	if len(store.released) != 1 || len(store.finished) != 0 {
		t.Errorf("want the lease released for re-execution, got released=%v finished=%+v", store.released, store.finished)
	}
}

func TestShutdownWaitsForJobsWithinTheGrace(t *testing.T) {
	store := &fakeStore{queue: []*claimed{{id: "j1", jobType: "quick", spec: sealed(t, `{}`)}}}
	started := make(chan struct{})
	w := testWorker(t, store, map[string]Executor{
		"quick": func(context.Context, jobs.Job) (map[string]any, error) {
			close(started)
			time.Sleep(10 * time.Millisecond)
			return map[string]any{"ok": true}, nil
		},
	})
	runUntil(t, w, func() bool {
		select {
		case <-started:
			return true
		default:
			return false
		}
	})
	if len(store.finished) != 1 || store.finished[0].err != nil {
		t.Errorf("a job finishing within the grace is recorded, got %+v", store.finished)
	}
}

func TestLoadConfig(t *testing.T) {
	t.Setenv("WORKER_ID", "")
	t.Setenv("WORKER_CONCURRENCY", "zero")
	t.Setenv("DOCKER_SOCKET_PATH", "/custom.sock")
	config := loadConfig()
	if config.Concurrency != 3 || config.ID == "" || config.DockerSocketPath != "/custom.sock" {
		t.Errorf("unexpected defaults %+v", config)
	}
	t.Setenv("WORKER_ID", "w1")
	t.Setenv("WORKER_CONCURRENCY", "5")
	config = loadConfig()
	if config.Concurrency != 5 || config.ID != "w1" {
		t.Errorf("unexpected config %+v", config)
	}
}
