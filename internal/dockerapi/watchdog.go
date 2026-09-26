package dockerapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/orochibraru/homerun/internal/activity"
)

var (
	// ControlTimeout bounds one control call (inspect, create, start, remove,
	// kill, a network or swarm call), headers and body together. The worker
	// sets it from WORKER_DOCKER_TIMEOUT at boot.
	ControlTimeout = 60 * time.Second
	// SlowTimeout bounds the few control calls the daemon legitimately takes
	// minutes over: prunes, `docker system df`, image removal.
	SlowTimeout = 30 * time.Minute
	// StallTimeout is how long a streaming call (logs, attach, pull, push,
	// save, load, a container wait) may go without a byte moving and without
	// its container proving alive before it's abandoned. It's not a total
	// deadline: a big backup that keeps streaming runs as long as it needs.
	// The worker sets it from WORKER_DOCKER_STALL_TIMEOUT at boot.
	StallTimeout = 10 * time.Minute
)

// StallError is a Docker call that got no answer in time: the daemon is up
// enough to accept the connection but stuck, usually on one container.
type StallError struct {
	// Call is the method and path that stalled.
	Call string
	// Container is the container the call was about, when it was about one.
	Container string
	// Idle is how long it went without an answer.
	Idle time.Duration
}

// Error names the call and, when known, the container the daemon is probably
// stuck on, with the one fix that clears a wedged daemon.
func (e *StallError) Error() string {
	message := fmt.Sprintf("Docker didn't answer for %s (%s)", e.Idle.Round(time.Second), e.Call)
	if e.Container == "" {
		return message + ": the daemon may be stuck."
	}
	return fmt.Sprintf("%s: the daemon may be stuck on container %s. If `docker inspect %s` hangs too, only restarting Docker clears it (sudo systemctl restart docker).",
		message, shortID(e.Container), shortID(e.Container))
}

// IsStall reports whether err is (or wraps) a StallError.
func IsStall(err error) bool {
	var stall *StallError
	return errors.As(err, &stall)
}

// shortID is a container id cut to the 12 characters `docker ps` shows.
func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// containerOf is the container id or name a /containers/<id>/... path is
// about, or "".
func containerOf(path string) string {
	rest, ok := strings.CutPrefix(path, "/containers/")
	if !ok {
		return ""
	}
	id, _, _ := strings.Cut(rest, "/")
	if id == "create" || id == "json" || id == "prune" {
		return ""
	}
	return id
}

// timeoutFor is the bound on one control call: SlowTimeout for prunes,
// `system df` and image removal, twice ControlTimeout for a stop or restart
// (the daemon waits out the container's own stop grace first), ControlTimeout
// otherwise.
func timeoutFor(method, path string) time.Duration {
	switch {
	case strings.HasSuffix(path, "/prune"), path == "/system/df",
		method == http.MethodDelete && strings.HasPrefix(path, "/images/"):
		return SlowTimeout
	case strings.HasSuffix(path, "/stop"), strings.HasSuffix(path, "/restart"), path == "/swarm/init":
		return 2 * ControlTimeout
	}
	return ControlTimeout
}

// stallFrom turns a call that failed because its own deadline passed into a
// StallError, leaving every other error (the caller's own cancellation
// included) as it was.
func stallFrom(parent, call context.Context, err error, method, path string, idle time.Duration) error {
	if err == nil || parent.Err() != nil || !errors.Is(call.Err(), context.DeadlineExceeded) {
		return err
	}
	return &StallError{Call: method + " " + path, Container: containerOf(path), Idle: idle}
}

// bounded sends one call under timeout, which covers reading its body too:
// the deadline is released when the caller closes the body.
func (c *Client) bounded(
	ctx context.Context,
	timeout time.Duration,
	method, path string,
	query url.Values,
	body any,
	auth *AuthConfig,
) (*http.Response, error) {
	reader, contentType, err := jsonBody(body)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	response, err := c.exchange(callCtx, method, path, query, reader, contentType, auth)
	if err != nil {
		cancel()
		return nil, stallFrom(ctx, callCtx, err, method, path, timeout)
	}
	activity.Touch(ctx)
	response.Body = &boundedBody{
		ReadCloser: response.Body, cancel: cancel, call: callCtx, method: method, parent: ctx, path: path, timeout: timeout,
	}
	return response, nil
}

type boundedBody struct {
	io.ReadCloser
	call    context.Context
	cancel  context.CancelFunc
	method  string
	parent  context.Context
	path    string
	timeout time.Duration
}

// Read reads the body, reporting a read cut by the call's deadline as a
// StallError.
func (b *boundedBody) Read(buffer []byte) (int, error) {
	n, err := b.ReadCloser.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		err = stallFrom(b.parent, b.call, err, b.method, b.path, b.timeout)
	}
	return n, err
}

// Close closes the body and releases the call's deadline.
func (b *boundedBody) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}

// probe reports whether whatever a quiet stream is waiting on is still alive
// (its container still running, the daemon still answering), which keeps the
// stream from being abandoned as stalled while it's legitimately silent.
type probe func(ctx context.Context) bool

// containerRunning is the probe for a stream about container id: alive while
// the daemon can still inspect it and it's still running.
func (c *Client) containerRunning(id string) probe {
	return func(ctx context.Context) bool {
		inspected, err := c.InspectContainer(ctx, id)
		return err == nil && inspected.State.Running
	}
}

// daemonAnswers is the probe for a stream about no one container: alive while
// the daemon answers a ping.
func (c *Client) daemonAnswers(ctx context.Context) bool {
	return c.Ping(ctx) == nil
}

// watch is one streaming call's stall watchdog: it cancels the call once
// nothing has moved for StallTimeout and its probe (if any) stopped vouching
// for it.
type watch struct {
	call        string
	cancel      context.CancelFunc
	cancelProbe context.CancelFunc
	container   string
	done        chan struct{}
	exited      chan struct{}
	last        atomic.Int64
	limit       time.Duration
	once        sync.Once
	parent      context.Context
	probeCtx    context.Context
	stalled     atomic.Pointer[StallError]
}

// newWatch starts the watchdog for call under ctx and returns it along with
// the context the call itself must run under.
func newWatch(ctx context.Context, method, path, container string, alive probe) (*watch, context.Context) {
	callCtx, cancel := context.WithCancel(ctx)
	probeCtx, cancelProbe := context.WithCancel(ctx)
	w := &watch{
		call: method + " " + path, cancel: cancel, cancelProbe: cancelProbe, container: container,
		done: make(chan struct{}), exited: make(chan struct{}), limit: StallTimeout, parent: ctx, probeCtx: probeCtx,
	}
	if w.container == "" {
		w.container = containerOf(path)
	}
	w.touch()
	go w.run(alive)
	return w, callCtx
}

// touch records that bytes moved, on the job's activity tracker too.
func (w *watch) touch() {
	w.last.Store(time.Now().UnixNano())
	activity.Touch(w.parent)
}

// idle is how long it's been since bytes last moved.
func (w *watch) idle() time.Duration {
	return time.Since(time.Unix(0, w.last.Load()))
}

// run checks the stream every tenth of the stall window: a stream quiet for a
// whole tick asks its probe, which counts as progress when it vouches for the
// stream, and one quiet for the whole window is cancelled as stalled.
func (w *watch) run(alive probe) {
	defer close(w.exited)
	tick := max(w.limit/10, time.Millisecond)
	ticker := time.NewTicker(tick)
	defer ticker.Stop()
	for {
		select {
		case <-w.done:
			return
		case <-w.parent.Done():
			return
		case <-ticker.C:
		}
		idle := w.idle()
		if idle >= w.limit {
			w.stalled.Store(&StallError{Call: w.call, Container: w.container, Idle: idle})
			w.cancel()
			return
		}
		if idle >= tick && alive != nil && alive(w.probeCtx) {
			w.touch()
		}
	}
}

// stop ends the watchdog, cutting short a probe in flight, waits for it to
// exit and releases the call's context.
func (w *watch) stop() {
	w.once.Do(func() {
		close(w.done)
		w.cancelProbe()
		<-w.exited
		w.cancel()
	})
}

// explain returns the StallError when the watchdog cut the call, err otherwise.
func (w *watch) explain(err error) error {
	if stall := w.stalled.Load(); stall != nil && err != nil && !errors.Is(err, io.EOF) {
		return stall
	}
	return err
}

type watchedReader struct {
	source io.Reader
	w      *watch
}

// Read reads from the source, counting bytes as progress.
func (r watchedReader) Read(buffer []byte) (int, error) {
	n, err := r.source.Read(buffer)
	if n > 0 {
		r.w.touch()
	}
	return n, err
}

type watchedBody struct {
	io.ReadCloser
	w *watch
}

// Read reads the response, counting bytes as progress and reporting a read
// the watchdog cut as a StallError.
func (b *watchedBody) Read(buffer []byte) (int, error) {
	n, err := b.ReadCloser.Read(buffer)
	if n > 0 {
		b.w.touch()
	}
	return n, b.w.explain(err)
}

// Close closes the response and stops its watchdog.
func (b *watchedBody) Close() error {
	err := b.ReadCloser.Close()
	b.w.stop()
	return err
}

// stream sends a streaming call with an optional JSON body, guarded by the
// stall watchdog rather than a deadline. alive vouches for a stream that's
// legitimately quiet; nil means only moving bytes count.
func (c *Client) stream(
	ctx context.Context,
	method, path string,
	query url.Values,
	body any,
	auth *AuthConfig,
	alive probe,
) (*http.Response, error) {
	reader, contentType, err := jsonBody(body)
	if err != nil {
		return nil, err
	}
	return c.upload(ctx, method, path, query, reader, contentType, auth, alive)
}

// upload sends a streaming call whose request body is itself a stream (an
// image load), guarded by the stall watchdog: bytes moving either way count
// as progress.
func (c *Client) upload(
	ctx context.Context,
	method, path string,
	query url.Values,
	body io.Reader,
	contentType string,
	auth *AuthConfig,
	alive probe,
) (*http.Response, error) {
	w, callCtx := newWatch(ctx, method, path, "", alive)
	if body != nil {
		body = watchedReader{source: body, w: w}
	}
	response, err := c.exchange(callCtx, method, path, query, body, contentType, auth)
	if err != nil {
		w.stop()
		return nil, w.explain(err)
	}
	w.touch()
	response.Body = &watchedBody{ReadCloser: response.Body, w: w}
	return response, nil
}
