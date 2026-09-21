package workerapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/workerapi"
)

const token = "worker-token"

// fakeDaemon stands in for the Docker Engine, answering a fixed body per path.
type fakeDaemon struct {
	bodies map[string]string
	status map[string]int
}

// ServeHTTP answers whatever was registered for the request's path, or 404.
func (f *fakeDaemon) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, ok := f.bodies[r.URL.Path]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"message":"No such container"}`)
		return
	}
	if status, ok := f.status[r.URL.Path]; ok {
		w.WriteHeader(status)
	}
	_, _ = io.WriteString(w, body)
}

// newAPI stands a worker control API over a fake daemon.
func newAPI(t *testing.T, daemon *fakeDaemon) *httptest.Server {
	t.Helper()
	engine := httptest.NewServer(daemon)
	t.Cleanup(engine.Close)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	docker := dockerapi.NewWithHTTP(engine.Client(), engine.URL)
	api := httptest.NewServer(workerapi.NewServer(ctx, token, docker).Handler())
	t.Cleanup(api.Close)
	return api
}

// call sends one request to the control API, with the bearer token unless
// anonymous is set.
func call(t *testing.T, api *httptest.Server, method, path string, anonymous bool) (int, string) {
	t.Helper()
	request, err := http.NewRequest(method, api.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !anonymous {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}

func TestHealthIsOpenAndEverythingElseIsNot(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{"/containers/json": `[]`}})

	if status, body := call(t, api, http.MethodGet, "/v1/health", true); status != http.StatusOK {
		t.Fatalf("health must be reachable without a token, got %d %s", status, body)
	}
	if status, _ := call(t, api, http.MethodGet, "/v1/containers", true); status != http.StatusUnauthorized {
		t.Fatalf("an unauthenticated control call must be 401, got %d", status)
	}
	if status, _ := call(t, api, http.MethodGet, "/v1/containers", false); status != http.StatusOK {
		t.Fatalf("an authenticated control call must pass, got %d", status)
	}
}

func TestContainerStatusDerivation(t *testing.T) {
	cases := map[string]struct {
		state    string
		exitCode int
		want     string
	}{
		"a running container":            {state: "running", want: "running"},
		"one created but not started":    {state: "created", want: "starting"},
		"one restarting":                 {state: "restarting", want: "starting"},
		"a clean exit":                   {state: "exited", exitCode: 0, want: "stopped"},
		"a non-zero exit":                {state: "exited", exitCode: 137, want: "failed"},
		"a dead container that exited 0": {state: "dead", exitCode: 0, want: "stopped"},
		"an unrecognised state":          {state: "paused", want: "stopped"},
	}
	for name, testCase := range cases {
		inspect, err := json.Marshal(map[string]any{
			"Id":    "c1",
			"State": map[string]any{"ExitCode": testCase.exitCode, "Status": testCase.state},
		})
		if err != nil {
			t.Fatal(err)
		}
		api := newAPI(t, &fakeDaemon{bodies: map[string]string{
			"/containers/c1/json": string(inspect),
		}})
		_, body := call(t, api, http.MethodGet, "/v1/containers/c1/status", false)
		var decoded struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal([]byte(body), &decoded); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if decoded.Status != testCase.want {
			t.Errorf("%s: want %q, got %q", name, testCase.want, decoded.Status)
		}
	}
}

func TestAContainerTheDaemonNeverHeardOfReadsAsMissing(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{}})
	_, body := call(t, api, http.MethodGet, "/v1/containers/gone/status", false)
	if !strings.Contains(body, `"missing"`) {
		t.Fatalf(`a 404 from the daemon must read as "missing", not "failed": %s`, body)
	}
}

func TestHealthHidesHomerunsOwnReadinessCheck(t *testing.T) {
	generated, err := json.Marshal(map[string]any{
		"Config": map[string]any{"Labels": map[string]string{"homerun.readiness": "listening"}},
		"State":  map[string]any{"Health": map[string]any{"Status": "healthy"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{"/containers/c1/json": string(generated)}})
	if _, body := call(t, api, http.MethodGet, "/v1/containers/c1/health", false); strings.TrimSpace(body) != "null" {
		t.Fatalf("a generated readiness check isn't the image's own healthcheck, got %s", body)
	}

	declared, err := json.Marshal(map[string]any{
		"Config": map[string]any{"Labels": map[string]string{}},
		"State": map[string]any{"Health": map[string]any{
			"Log":    []any{map[string]any{"Output": "all good"}},
			"Status": "healthy",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	api = newAPI(t, &fakeDaemon{bodies: map[string]string{"/containers/c1/json": string(declared)}})
	_, body := call(t, api, http.MethodGet, "/v1/containers/c1/health", false)
	if !strings.Contains(body, "healthy") || !strings.Contains(body, "all good") {
		t.Fatalf("a real healthcheck must report its status and last output, got %s", body)
	}
}

func TestSwarmStatusAggregation(t *testing.T) {
	replicated := `{"Spec":{"Mode":{"Replicated":{"Replicas":2}}}}`
	cases := map[string]struct {
		tasks string
		want  string
	}{
		"no tasks yet":              {tasks: `[]`, want: "pending"},
		"one running wins":          {tasks: `[{"Status":{"State":"failed"}},{"Status":{"State":"running"}}]`, want: "running"},
		"a failed task with no run": {tasks: `[{"Status":{"State":"failed"}}]`, want: "failed"},
		"a rejected task":           {tasks: `[{"Status":{"State":"rejected"}}]`, want: "failed"},
		"still starting":            {tasks: `[{"Status":{"State":"preparing"}}]`, want: "starting"},
	}
	for name, testCase := range cases {
		api := newAPI(t, &fakeDaemon{bodies: map[string]string{
			"/services/s1": replicated,
			"/tasks":       testCase.tasks,
		}})
		_, body := call(t, api, http.MethodGet, "/v1/swarm/services/s1/status", false)
		if !strings.Contains(body, `"`+testCase.want+`"`) {
			t.Errorf("%s: want %q, got %s", name, testCase.want, body)
		}
	}
}

func TestInspectSwarmServiceByName(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{
		"/services/homerun-newt": `{"ID":"s1","Spec":{"Name":"homerun-newt","Labels":{"homerun.core":"newt"}}}`,
	}})
	status, body := call(t, api, http.MethodGet, "/v1/swarm/services/homerun-newt", false)
	if status != http.StatusOK || !strings.Contains(body, `"homerun.core":"newt"`) {
		t.Fatalf("the labels are what tells a sync whether the service is current, got %d %s", status, body)
	}
	if status, _ := call(t, api, http.MethodGet, "/v1/swarm/services/gone", false); status != http.StatusNotFound {
		t.Fatalf("a missing service must read as 404, got %d", status)
	}
}

func TestCreateSwarmServiceNeedsAName(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{"/services/create": `{"ID":"s1"}`}})
	status, body := call(t, api, http.MethodPost, "/v1/swarm/services", false)
	if status != http.StatusBadRequest {
		t.Fatalf("an empty body has no name, got %d %s", status, body)
	}
}

func TestASwarmServiceScaledToZeroIsStopped(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{
		"/services/s1": `{"Spec":{"Mode":{"Replicated":{"Replicas":0}}}}`,
		"/tasks":       `[{"Status":{"State":"running"}}]`,
	}})
	if _, body := call(t, api, http.MethodGet, "/v1/swarm/services/s1/status", false); !strings.Contains(body, "stopped") {
		t.Fatalf("zero replicas is stopped however its leftover tasks look, got %s", body)
	}
}

func TestLogsAreDemuxedBeforeTheyLeaveTheWorker(t *testing.T) {
	framed := "\x01\x00\x00\x00\x00\x00\x00\x06hello\n" + "\x02\x00\x00\x00\x00\x00\x00\x06world\n"
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{"/containers/c1/logs": framed}})
	_, body := call(t, api, http.MethodGet, "/v1/containers/c1/logs?follow=0", false)
	if body != "hello\nworld\n" {
		t.Fatalf("the 8-byte frame headers must be stripped, got %q", body)
	}
}

func TestTtyLogsArePassedThroughUnmangled(t *testing.T) {
	// Every service Homerun deploys runs with Tty, and a TTY container's logs
	// carry no frame headers at all. Demuxing them anyway would eat eight
	// bytes out of each imaginary frame.
	raw := "listening on :8080\nready\n"
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{"/containers/c1/logs": raw}})
	_, body := call(t, api, http.MethodGet, "/v1/containers/c1/logs?follow=0", false)
	if body != raw {
		t.Fatalf("unframed TTY output must pass through untouched, got %q", body)
	}
}

func TestShortUnframedLogsSurvive(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{"/containers/c1/logs": "hi\n"}})
	_, body := call(t, api, http.MethodGet, "/v1/containers/c1/logs?follow=0", false)
	if body != "hi\n" {
		t.Fatalf("output shorter than one header must still come through, got %q", body)
	}
}

func TestPruneRejectsAnUnknownKind(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{}})
	status, body := call(t, api, http.MethodPost, "/v1/prune/everything", false)
	if status != http.StatusBadRequest || !strings.Contains(body, "kind") {
		t.Fatalf("an unknown prune kind must be a 400 naming the field, got %d %s", status, body)
	}
}

func TestAnUnknownTerminalSessionIs404(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{}})
	if status, _ := call(t, api, http.MethodGet, "/v1/terminal/nope", false); status != http.StatusNotFound {
		t.Fatalf("an unknown session must be 404, got %d", status)
	}
	if status, _ := call(t, api, http.MethodDelete, "/v1/terminal/nope", false); status != http.StatusOK {
		t.Fatalf("closing an already-closed session is a success, got %d", status)
	}
}

func TestUnknownPathsAnswerJSON(t *testing.T) {
	api := newAPI(t, &fakeDaemon{bodies: map[string]string{}})
	status, body := call(t, api, http.MethodGet, "/v1/nope", false)
	if status != http.StatusNotFound || !strings.Contains(body, "Not found") {
		t.Fatalf("want a JSON 404, got %d %s", status, body)
	}
}
