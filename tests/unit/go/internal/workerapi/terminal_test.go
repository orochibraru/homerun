package workerapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/dockersocket"
	"github.com/orochibraru/homerun/internal/workerapi"
)

// fakeShellDaemon plays a container with one TTY shell exec, whose output is
// chunks written with a pause between them, and records every kill exec.
type fakeShellDaemon struct {
	chunks  []string
	failing bool

	mu    sync.Mutex
	kills [][]string
}

// ServeHTTP answers exec create, the shell's hijacked start, and the kill
// exec's start and inspect.
func (f *fakeShellDaemon) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/containers/box/exec":
		var body struct {
			Cmd []string
			Tty bool
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Tty {
			_, _ = io.WriteString(w, `{"Id":"shell"}`)
			return
		}
		f.mu.Lock()
		f.kills = append(f.kills, body.Cmd)
		f.mu.Unlock()
		if f.failing {
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"message":"container box is not running"}`)
			return
		}
		_, _ = io.WriteString(w, `{"Id":"kill"}`)
	case "/exec/shell/start":
		conn, buffered, err := http.NewResponseController(w).Hijack()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_, _ = buffered.WriteString("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
		_ = buffered.Flush()
		for _, chunk := range f.chunks {
			time.Sleep(30 * time.Millisecond)
			_, _ = conn.Write([]byte(chunk))
		}
		_, _ = io.Copy(io.Discard, conn)
	case "/exec/kill/start":
		w.WriteHeader(http.StatusOK)
	case "/exec/kill/json":
		_, _ = io.WriteString(w, `{"ExitCode":0}`)
	case "/containers/box/json":
		_, _ = io.WriteString(w, `{"State":{"Running":true}}`)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// killed is every kill exec's command so far.
func (f *fakeShellDaemon) killed() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]string{}, f.kills...)
}

// openShell opens a session in the fake container and collects its output
// until the session closes.
func openShell(t *testing.T, daemon *fakeShellDaemon) (*workerapi.TerminalHub, string, func() string) {
	t.Helper()
	engine := httptest.NewServer(daemon)
	t.Cleanup(engine.Close)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	hub := workerapi.NewTerminalHub(ctx, dockerapi.NewWithHTTP(engine.Client(), engine.URL))
	id, err := hub.Open(ctx, "box", nil)
	if err != nil {
		t.Fatal(err)
	}
	chunks, _, err := hub.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	done := make(chan struct{})
	go func() {
		for chunk := range chunks {
			output.Write(chunk)
		}
		close(done)
	}()
	return hub, id, func() string {
		<-done
		return output.String()
	}
}

func TestTerminalStripsThePIDMarkerSplitAcrossReadsAndKillsItsSessionOnClose(t *testing.T) {
	daemon := &fakeShellDaemon{chunks: []string{"\x1b]homerun-p", "id;42", "42\x07/ # ", "ls\r\n"}}
	hub, id, output := openShell(t, daemon)
	time.Sleep(300 * time.Millisecond)
	if err := hub.Close(id); err != nil {
		t.Fatal(err)
	}
	if got := output(); got != "/ # ls\r\n" {
		t.Fatalf("the marker must never reach a listener, got %q", got)
	}
	kills := daemon.killed()
	if len(kills) != 1 || kills[0][len(kills[0])-1] != "4242" {
		t.Fatalf("Close must run one kill exec for pid 4242, got %q", kills)
	}
	if hub.Exists(id) {
		t.Fatal("a closed session must be gone")
	}
}

func TestTerminalPassesOutputWithoutAMarkerThroughAndKillsNothing(t *testing.T) {
	daemon := &fakeShellDaemon{chunks: []string{"\x1b[1mhello", " world"}}
	hub, id, output := openShell(t, daemon)
	time.Sleep(200 * time.Millisecond)
	_ = hub.Close(id)
	if got := output(); got != "\x1b[1mhello world" {
		t.Fatalf("output without the marker must pass through untouched, got %q", got)
	}
	if kills := daemon.killed(); len(kills) != 0 {
		t.Fatalf("no PID means nothing to kill, got %q", kills)
	}
}

func TestTerminalCloseSurvivesAFailedKill(t *testing.T) {
	daemon := &fakeShellDaemon{chunks: []string{"\x1b]homerun-pid;7\x07$ "}, failing: true}
	hub, id, output := openShell(t, daemon)
	time.Sleep(200 * time.Millisecond)
	if err := hub.Close(id); err != nil {
		t.Fatalf("a failed kill must not fail Close, got %s", err)
	}
	if got := output(); got != "$ " {
		t.Fatalf("got %q", got)
	}
	if len(daemon.killed()) != 1 || hub.Exists(id) {
		t.Fatal("Close must still try the kill once and end the session")
	}
}

func TestTerminalCloseLeavesNoProcessBehindOnRealDocker(t *testing.T) {
	docker := dockerapi.New(dockersocket.Resolve(""))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := docker.Ping(ctx); err != nil {
		t.Skipf("no Docker daemon: %v", err)
	}
	if err := docker.EnsureImage(ctx, "alpine:3"); err != nil {
		t.Fatal(err)
	}
	container, err := docker.CreateContainer(ctx, dockerapi.ContainerConfig{Image: "alpine:3", Cmd: []string{"sleep", "infinity"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = docker.KillContainer(context.Background(), container)
		_ = docker.RemoveContainer(context.Background(), container)
	})
	if err := docker.StartContainer(ctx, container); err != nil {
		t.Fatal(err)
	}
	hub := workerapi.NewTerminalHub(ctx, docker)
	processes := func() string {
		result, err := docker.ContainerExec(ctx, container, []string{"ps", "-o", "pid,args"})
		if err != nil {
			t.Fatal(err)
		}
		return result.Stdout
	}
	for _, input := range []string{"sleep 2000 &\n", "sleep 1000\n"} {
		id, err := hub.Open(ctx, container, nil)
		if err != nil {
			t.Fatal(err)
		}
		chunks, _, err := hub.Subscribe(id)
		if err != nil {
			t.Fatal(err)
		}
		time.Sleep(300 * time.Millisecond)
		if err := hub.Write(id, []byte(input)); err != nil {
			t.Fatal(err)
		}
		time.Sleep(500 * time.Millisecond)
		if running := processes(); !strings.Contains(running, "sleep "+strings.Fields(input)[1]) {
			t.Fatalf("the session's command must be running before Close, got\n%s", running)
		}
		if err := hub.Close(id); err != nil {
			t.Fatal(err)
		}
		var seen strings.Builder
		for chunk := range chunks {
			seen.Write(chunk)
		}
		if strings.Contains(seen.String(), "homerun-pid") {
			t.Fatalf("the PID marker leaked into the output: %q", seen.String())
		}
	}
	running := processes()
	for _, leaked := range []string{"/bin/sh", "sleep 1000", "sleep 2000"} {
		if strings.Contains(running, leaked) {
			t.Fatalf("%q survived Close:\n%s", leaked, running)
		}
	}
}

// pipeShell is an adopted shell whose output the test writes by hand.
type pipeShell struct {
	io.Reader
	io.Writer
}

// Close ends nothing: the test closes the pipe itself.
func (pipeShell) Close() error { return nil }

func TestAdoptedShellReplaysOutputPrintedBeforeTheFirstSubscriber(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	hub := workerapi.NewTerminalHub(ctx, nil)
	reader, writer := io.Pipe()
	id := hub.Adopt("ssh://me@box", pipeShell{Reader: reader, Writer: io.Discard}, nil)
	if _, err := writer.Write([]byte("welcome\r\n$ ")); err != nil {
		t.Fatal(err)
	}
	chunks, unsubscribe, err := hub.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	select {
	case chunk := <-chunks:
		if string(chunk) != "welcome\r\n$ " {
			t.Fatalf("first chunk = %q", chunk)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the banner printed before subscribing never arrived")
	}
}
