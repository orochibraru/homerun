package workerapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strconv"
	"sync"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/logging"
)

// scope labels every line the terminal hub logs.
const scope = "terminal"

// idleTimeout is how long a terminal session may go without input or output
// before the reaper closes it, so a browser tab closed without a goodbye
// doesn't leave a shell running in a container forever.
const idleTimeout = 15 * time.Minute

// reapInterval is how often the hub looks for sessions past idleTimeout.
const reapInterval = time.Minute

// defaultShell prefers bash and falls back to sh, so a container with bash
// gets line editing and completion without one without it failing to open.
//
// It first prints its own PID inside the container as an OSC sequence
// (pidMarkerPrefix), which the pump strips before anyone sees it. `exec` keeps
// that PID, and a TTY exec runs as a session leader, so it's the session id of
// everything the user starts in the shell too; Close uses it to kill them.
// Exec inspect can't stand in for this: its Pid is the host's, not the
// container's.
var defaultShell = []string{"/bin/sh", "-c",
	`printf '\033]homerun-pid;%s\007' $$; if [ -x /bin/bash ]; then exec /bin/bash; fi; exec /bin/sh`}

// pidMarkerPrefix opens the OSC sequence defaultShell prints its PID in; a BEL
// ends it.
var pidMarkerPrefix = []byte("\x1b]homerun-pid;")

// pidMarkerMax is how many bytes the pump buffers looking for the marker
// before it gives up and passes them through untouched.
const pidMarkerMax = 64

// pidWait is how long Close waits for the shell's PID when a session is closed
// before its first output arrived.
const pidWait = 2 * time.Second

// killTimeout bounds the exec that kills a closed session's processes.
const killTimeout = 5 * time.Second

// killScript HUPs every process in the session led by the PID it's given,
// then KILLs whatever survived a one-second grace. It scans /proc with shell
// builtins only, since busybox ps can't print a session id and a slim image
// may have no ps at all.
const killScript = `s=$1
scan() {
	found=
	for f in /proc/[0-9]*/stat; do
		read -r line < "$f" 2>/dev/null || continue
		set -- ${line##*) }
		if [ "$4" = "$s" ]; then p=${f#/proc/}; found="$found ${p%/stat}"; fi
	done
}
scan
[ -z "$found" ] && exit 0
kill -HUP $found 2>/dev/null
sleep 1
scan
[ -n "$found" ] && kill -KILL $found 2>/dev/null
exit 0`

// session is one live shell inside a container, with the hijacked stream
// it runs over and the set of readers currently watching its output.
type session struct {
	mu           sync.Mutex
	listeners    map[int]chan []byte
	nextListener int
	closed       bool
	marker       []byte
	pid          int
	pidReady     chan struct{}

	ContainerID string
	CreatedAt   time.Time
	ExecID      string
	ID          string
	LastActive  time.Time
	stream      *dockerapi.HijackedStream
}

// TerminalHub owns every open terminal session on this host.
//
// Ownership is deliberately not modelled here: the app checks that the user
// asking owns the service before it ever calls, exactly as the TypeScript
// terminal service did, and this side only ever knows a container id. Keeping
// it that way means the worker has no notion of users to get wrong.
type TerminalHub struct {
	mu       sync.Mutex
	sessions map[string]*session

	docker *dockerapi.Client
	done   chan struct{}
}

// NewTerminalHub builds a hub over one daemon and starts its idle reaper,
// which runs for the life of ctx.
func NewTerminalHub(ctx context.Context, docker *dockerapi.Client) *TerminalHub {
	hub := &TerminalHub{docker: docker, done: make(chan struct{}), sessions: map[string]*session{}}
	go hub.reap(ctx)
	return hub
}

// Open starts a shell in a running container and returns the new session's id.
func (h *TerminalHub) Open(ctx context.Context, containerID string, command []string) (string, error) {
	marked := len(command) == 0
	if marked {
		command = defaultShell
	}
	execID, err := h.docker.CreateExec(ctx, containerID, dockerapi.ExecConfig{
		Cmd: command, Stdin: true, Tty: true,
	})
	if err != nil {
		return "", err
	}
	stream, err := h.docker.StartExecHijacked(context.WithoutCancel(ctx), execID, true)
	if err != nil {
		return "", err
	}
	now := time.Now()
	current := &session{
		ContainerID: containerID,
		CreatedAt:   now,
		ExecID:      execID,
		ID:          randomID(),
		LastActive:  now,
		listeners:   map[int]chan []byte{},
		pidReady:    make(chan struct{}),
		stream:      stream,
	}
	if !marked {
		close(current.pidReady)
	}
	h.mu.Lock()
	h.sessions[current.ID] = current
	h.mu.Unlock()

	go h.pump(current)
	logging.Infof(scope, "%s opened in %s", current.ID, containerID)
	return current.ID, nil
}

// pump reads the shell's output until it ends, fanning every chunk out to the
// session's current listeners and closing the session when the shell exits.
func (h *TerminalHub) pump(current *session) {
	buffer := make([]byte, 8192)
	for {
		read, err := current.stream.Read(buffer)
		if read > 0 {
			chunk := make([]byte, read)
			copy(chunk, buffer[:read])
			if chunk = current.takePID(chunk); len(chunk) > 0 {
				current.broadcast(chunk)
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				logging.Debugf(scope, "%s ended: %s", current.ID, err)
			}
			current.markPID(0)
			h.close(current.ID, true)
			return
		}
	}
}

// takePID strips defaultShell's PID marker off the start of the output, which
// may arrive split across reads, and returns what's left to show. Output that
// doesn't start with the marker passes through untouched.
func (s *session) takePID(chunk []byte) []byte {
	select {
	case <-s.pidReady:
		return chunk
	default:
	}
	s.marker = append(s.marker, chunk...)
	buffered := s.marker
	if len(buffered) < len(pidMarkerPrefix) {
		if bytes.HasPrefix(pidMarkerPrefix, buffered) {
			return nil
		}
		s.markPID(0)
		return buffered
	}
	if !bytes.HasPrefix(buffered, pidMarkerPrefix) {
		s.markPID(0)
		return buffered
	}
	end := bytes.IndexByte(buffered, '\a')
	if end < 0 {
		if len(buffered) > pidMarkerMax {
			s.markPID(0)
			return buffered
		}
		return nil
	}
	pid, err := strconv.Atoi(string(buffered[len(pidMarkerPrefix):end]))
	if err != nil || pid <= 0 {
		pid = 0
	}
	s.markPID(pid)
	return buffered[end+1:]
}

// markPID records the shell's PID (0 for unknown) and releases anyone waiting
// on it. Only the first call counts.
func (s *session) markPID(pid int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.pidReady:
		return
	default:
	}
	s.pid = pid
	s.marker = nil
	close(s.pidReady)
}

// broadcast hands a chunk to every listener, dropping it for one whose buffer
// is full rather than stalling the shell for everyone else.
func (s *session) broadcast(chunk []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastActive = time.Now()
	for _, listener := range s.listeners {
		select {
		case listener <- chunk:
		default:
		}
	}
}

// Subscribe registers a reader for a session's output and returns its channel
// plus the function that unregisters it.
func (h *TerminalHub) Subscribe(id string) (<-chan []byte, func(), error) {
	current, err := h.get(id)
	if err != nil {
		return nil, nil, err
	}
	current.mu.Lock()
	defer current.mu.Unlock()
	if current.closed {
		return nil, nil, errNoSession
	}
	key := current.nextListener
	current.nextListener++
	channel := make(chan []byte, 256)
	current.listeners[key] = channel
	return channel, func() {
		current.mu.Lock()
		defer current.mu.Unlock()
		if listener, ok := current.listeners[key]; ok {
			delete(current.listeners, key)
			close(listener)
		}
	}, nil
}

// Write sends input to a session's shell.
func (h *TerminalHub) Write(id string, data []byte) error {
	current, err := h.get(id)
	if err != nil {
		return err
	}
	current.mu.Lock()
	current.LastActive = time.Now()
	closed := current.closed
	current.mu.Unlock()
	if closed {
		return errNoSession
	}
	_, err = current.stream.Write(data)
	return err
}

// Resize tells the shell its terminal changed size.
func (h *TerminalHub) Resize(ctx context.Context, id string, height, width int) error {
	current, err := h.get(id)
	if err != nil {
		return err
	}
	return h.docker.ResizeExec(ctx, current.ExecID, height, width)
}

// Close ends a session and releases every listener watching it, first killing
// the shell and everything started from it: Docker leaves an exec's process
// running when its stream detaches. Closing one that's already gone is not an
// error: both the reaper and the shell's own exit can get here first.
func (h *TerminalHub) Close(id string) error {
	h.close(id, false)
	return nil
}

// close is Close, told whether the shell already ended by itself, in which
// case a failed kill is expected (the container may be what went away) and
// logged quietly.
func (h *TerminalHub) close(id string, ended bool) {
	h.mu.Lock()
	current, ok := h.sessions[id]
	if ok {
		delete(h.sessions, id)
	}
	h.mu.Unlock()
	if !ok {
		return
	}
	h.kill(current, ended)
	current.mu.Lock()
	current.closed = true
	for key, listener := range current.listeners {
		delete(current.listeners, key)
		close(listener)
	}
	current.mu.Unlock()
	_ = current.stream.Close()
	logging.Infof(scope, "%s closed", id)
}

// kill ends every process in a session's shell session inside its container,
// bounded by killTimeout. A session whose PID never arrived is left alone.
func (h *TerminalHub) kill(current *session, ended bool) {
	select {
	case <-current.pidReady:
	case <-time.After(pidWait):
	}
	current.mu.Lock()
	pid := current.pid
	current.mu.Unlock()
	if pid == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), killTimeout)
	defer cancel()
	result, err := h.docker.ContainerExec(ctx, current.ContainerID,
		[]string{"/bin/sh", "-c", killScript, "kill", strconv.Itoa(pid)})
	switch {
	case err != nil && ended:
		logging.Debugf(scope, "%s: couldn't reap its processes: %s", current.ID, err)
	case err != nil:
		logging.Warnf(scope, "%s: couldn't kill its shell (pid %d) in %s: %s", current.ID, pid, current.ContainerID, err)
	case result.ExitCode != 0:
		logging.Warnf(scope, "%s: killing its shell (pid %d) exited %d: %s", current.ID, pid, result.ExitCode, result.Stderr)
	}
}

// Exists reports whether a session is still open, for the app's own ownership
// re-check before it streams.
func (h *TerminalHub) Exists(id string) bool {
	_, err := h.get(id)
	return err == nil
}

// ContainerOf is the container a session runs in, so the app can confirm the
// session belongs to the service the request names.
func (h *TerminalHub) ContainerOf(id string) (string, error) {
	current, err := h.get(id)
	if err != nil {
		return "", err
	}
	return current.ContainerID, nil
}

// randomID mints an opaque session id. A session id is a capability for as
// long as it lives, so it comes from crypto/rand rather than a counter.
func randomID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(buffer)
}

// errNoSession is what every lookup of an unknown or finished session returns,
// which the routes answer as a 404.
var errNoSession = errors.New("that terminal session isn't open")

// get finds a live session by id.
func (h *TerminalHub) get(id string) (*session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	current, ok := h.sessions[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", errNoSession, id)
	}
	return current, nil
}

// reap closes sessions idle past idleTimeout until ctx ends, then closes every
// remaining session so a shutdown doesn't leave shells running.
func (h *TerminalHub) reap(ctx context.Context) {
	ticker := time.NewTicker(reapInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			h.closeAll()
			close(h.done)
			return
		case <-ticker.C:
			h.closeIdle()
		}
	}
}

// Done is closed once the hub has closed every session after its context
// ended, so a shutdown can wait for the shells to be killed before exiting.
func (h *TerminalHub) Done() <-chan struct{} {
	return h.done
}

// closeIdle closes every session whose last activity is past idleTimeout.
func (h *TerminalHub) closeIdle() {
	cutoff := time.Now().Add(-idleTimeout)
	h.mu.Lock()
	stale := []string{}
	for id, current := range h.sessions {
		current.mu.Lock()
		if current.LastActive.Before(cutoff) {
			stale = append(stale, id)
		}
		current.mu.Unlock()
	}
	h.mu.Unlock()
	for _, id := range stale {
		logging.Infof(scope, "%s reaped after %s idle", id, idleTimeout)
		_ = h.Close(id)
	}
}

// closeAll ends every open session.
func (h *TerminalHub) closeAll() {
	h.mu.Lock()
	ids := make([]string, 0, len(h.sessions))
	for id := range h.sessions {
		ids = append(ids, id)
	}
	h.mu.Unlock()
	var group sync.WaitGroup
	for _, id := range ids {
		group.Go(func() { _ = h.Close(id) })
	}
	group.Wait()
}
