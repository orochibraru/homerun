package workerapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
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
var defaultShell = []string{"/bin/sh", "-c", "if [ -x /bin/bash ]; then exec /bin/bash; fi; exec /bin/sh"}

// session is one live shell inside a container, with the hijacked stream
// it runs over and the set of readers currently watching its output.
type session struct {
	mu           sync.Mutex
	listeners    map[int]chan []byte
	nextListener int
	closed       bool

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
}

// NewTerminalHub builds a hub over one daemon and starts its idle reaper,
// which runs for the life of ctx.
func NewTerminalHub(ctx context.Context, docker *dockerapi.Client) *TerminalHub {
	hub := &TerminalHub{docker: docker, sessions: map[string]*session{}}
	go hub.reap(ctx)
	return hub
}

// Open starts a shell in a running container and returns the new session's id.
func (h *TerminalHub) Open(ctx context.Context, containerID string, command []string) (string, error) {
	if len(command) == 0 {
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
		stream:      stream,
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
			current.broadcast(chunk)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				logging.Debugf(scope, "%s ended: %s", current.ID, err)
			}
			_ = h.Close(current.ID)
			return
		}
	}
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

// Close ends a session and releases every listener watching it. Closing one
// that's already gone is not an error: both the reaper and the shell's own
// exit can get here first.
func (h *TerminalHub) Close(id string) error {
	h.mu.Lock()
	current, ok := h.sessions[id]
	if ok {
		delete(h.sessions, id)
	}
	h.mu.Unlock()
	if !ok {
		return nil
	}
	current.mu.Lock()
	current.closed = true
	for key, listener := range current.listeners {
		delete(current.listeners, key)
		close(listener)
	}
	current.mu.Unlock()
	_ = current.stream.Close()
	logging.Infof(scope, "%s closed", id)
	return nil
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
			return
		case <-ticker.C:
			h.closeIdle()
		}
	}
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
	for _, id := range ids {
		_ = h.Close(id)
	}
}
