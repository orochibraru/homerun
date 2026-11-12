package agent_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/zedensix/homerun/internal/agent"
	"github.com/zedensix/homerun/internal/dockerapi"
)

type fakeEvents struct {
	since time.Time
}

func (f *fakeEvents) Events(_ context.Context, since time.Time) ([]dockerapi.Event, error) {
	f.since = since
	return []dockerapi.Event{{Action: "start", ID: "abc", Name: "web", Time: 1, Type: "container"}}, nil
}

func newAdminServer(t *testing.T, admin *agent.Admin) *httptest.Server {
	t.Helper()
	router := chi.NewRouter()
	admin.Mount(router)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return server
}

func TestLogBufferKeepsTheLastLines(t *testing.T) {
	logs := agent.NewLogBuffer(3)
	_, _ = fmt.Fprint(logs, "one\ntwo\n")
	_, _ = fmt.Fprint(logs, "three\n\nfour\n")
	lines := logs.Lines()
	got := []string{}
	for _, line := range lines {
		got = append(got, line.Line)
	}
	if strings.Join(got, ",") != "two,three,four" {
		t.Errorf("want the last three non-empty lines, got %v", got)
	}
}

func TestLogsAndEventsRoutes(t *testing.T) {
	logs := agent.NewLogBuffer(10)
	_, _ = fmt.Fprint(logs, "[info] [build] hello\n")
	events := &fakeEvents{}
	server := newAdminServer(t, &agent.Admin{Docker: events, Logs: logs})

	response, body := call(t, http.MethodGet, server.URL+"/v1/logs", "", "")
	if response.StatusCode != http.StatusOK || !strings.Contains(body, `"line":"[info] [build] hello"`) {
		t.Errorf("logs: %d %s", response.StatusCode, body)
	}

	response, body = call(t, http.MethodGet, server.URL+"/v1/events", "", "")
	if response.StatusCode != http.StatusOK || !strings.Contains(body, `"name":"web"`) {
		t.Errorf("events: %d %s", response.StatusCode, body)
	}
	if age := time.Since(events.since); age < 23*time.Hour || age > 25*time.Hour {
		t.Errorf("events should look back a day, looked back %s", age)
	}
}

func TestUpdateReplacesTheBinaryThenRestarts(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "homerun-worker")
	if err := os.WriteFile(executable, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	restarted := make(chan struct{})
	requested := ""
	server := newAdminServer(t, &agent.Admin{
		Download: func(version string) (string, error) {
			requested = version
			staged := filepath.Join(dir, ".staged")
			return staged, os.WriteFile(staged, []byte("new"), 0o755)
		},
		Executable: executable,
		Restart:    func() { close(restarted) },
	})

	response, body := call(t, http.MethodPost, server.URL+"/v1/update", "", `{"version":"v1.2.3"}`)
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("got %d %s", response.StatusCode, body)
	}
	var answer map[string]string
	if err := json.Unmarshal([]byte(body), &answer); err != nil || answer["version"] != "1.2.3" {
		t.Errorf("the answer should name the new version, got %s", body)
	}
	if requested != "1.2.3" {
		t.Errorf("the release asked for should drop the v, got %q", requested)
	}
	if content, _ := os.ReadFile(executable); string(content) != "new" {
		t.Errorf("the binary should be replaced, holds %q", content)
	}
	select {
	case <-restarted:
	case <-time.After(2 * time.Second):
		t.Error("an update should restart the agent")
	}
}

func TestUpdateRefusesABadVersionAndAnUnwritableBinary(t *testing.T) {
	dir := t.TempDir()
	server := newAdminServer(t, &agent.Admin{
		Download: func(string) (string, error) {
			staged := filepath.Join(dir, ".staged")
			return staged, os.WriteFile(staged, []byte("new"), 0o755)
		},
		Executable: filepath.Join(dir, "missing", "homerun-worker"),
		Restart:    func() { t.Error("a failed update must not restart") },
	})

	response, _ := call(t, http.MethodPost, server.URL+"/v1/update", "", `{"version":"latest"}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("a non-release version should be refused, got %d", response.StatusCode)
	}
	response, body := call(t, http.MethodPost, server.URL+"/v1/update", "", `{"version":"1.2.3"}`)
	if response.StatusCode != http.StatusConflict || !strings.Contains(body, "re-run the installer") {
		t.Errorf("an unreplaceable binary should say how to fix it, got %d %s", response.StatusCode, body)
	}
	if _, err := os.Stat(filepath.Join(dir, ".staged")); !os.IsNotExist(err) {
		t.Error("a failed update should clean up the staged download")
	}
}

func TestAdminRoutesNeedTheToken(t *testing.T) {
	docker := newFakeDocker()
	admin := &agent.Admin{Docker: &fakeEvents{}, Logs: agent.NewLogBuffer(10)}
	server := httptest.NewServer(agent.NewServer(testToken, docker, newTestBuilder(docker), nil, admin.Mount).Handler())
	t.Cleanup(server.Close)
	for _, route := range []string{"/v1/logs", "/v1/events"} {
		if response, _ := call(t, http.MethodGet, server.URL+route, "", ""); response.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s answered %d without a token", route, response.StatusCode)
		}
		if response, _ := call(t, http.MethodGet, server.URL+route, "Bearer "+testToken, ""); response.StatusCode != http.StatusOK {
			t.Errorf("%s answered %d with the token", route, response.StatusCode)
		}
	}
	if response, _ := call(t, http.MethodPost, server.URL+"/v1/update", "", `{"version":"1.2.3"}`); response.StatusCode != http.StatusUnauthorized {
		t.Errorf("update answered %d without a token", response.StatusCode)
	}
}
