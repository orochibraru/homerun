package cli_test

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/cli"
	"github.com/orochibraru/homerun/internal/homerun"
	"github.com/orochibraru/homerun/internal/release"
)

func TestResolveConfigPrefersFlagsThenEnvThenStore(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("HOMERUN_BASE_URL", "")
	t.Setenv("HOMERUN_API_KEY", "")

	if config := homerun.ResolveConfig("", ""); config != nil {
		t.Fatalf("expected nil without any source, got %+v", config)
	}

	t.Setenv("HOMERUN_BASE_URL", "https://env.example.com")
	t.Setenv("HOMERUN_API_KEY", "env-key")
	config := homerun.ResolveConfig("", "")
	if config == nil || config.BaseURL != "https://env.example.com" || config.APIKey != "env-key" {
		t.Fatalf("env vars not used: %+v", config)
	}

	config = homerun.ResolveConfig("https://flag.example.com/", "flag-key")
	if config.BaseURL != "https://flag.example.com" {
		t.Errorf("flag should win and lose its trailing slash, got %q", config.BaseURL)
	}
	if config.APIKey != "flag-key" {
		t.Errorf("flag api key should win, got %q", config.APIKey)
	}
}

func TestStoredConfigRoundTripIsPrivate(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if stored := homerun.ReadStoredConfig(); stored != nil {
		t.Fatalf("expected no config in a fresh home, got %+v", stored)
	}
	if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "k", BaseURL: "https://example.com"}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	stored := homerun.ReadStoredConfig()
	if stored == nil || stored.APIKey != "k" || stored.BaseURL != "https://example.com" {
		t.Fatalf("round trip lost data: %+v", stored)
	}

	info, err := os.Stat(filepath.Join(home, ".config", "homerun", "config.json"))
	if err != nil {
		t.Fatalf("stat failed: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("config holds a live API key, want mode 0600, got %o", mode)
	}

	homerun.ClearStoredConfig()
	if stored := homerun.ReadStoredConfig(); stored != nil {
		t.Errorf("logout should clear the config, got %+v", stored)
	}
}

func TestReadStoredConfigIgnoresJunk(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.MkdirAll(filepath.Join(home, ".config", "homerun"), 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".config", "homerun", "config.json")

	for name, body := range map[string]string{
		"not json":      "{nope",
		"missing key":   `{"baseUrl":"https://example.com"}`,
		"missing url":   `{"apiKey":"k"}`,
		"wrong types":   `{"apiKey":1,"baseUrl":2}`,
		"empty strings": `{"apiKey":"","baseUrl":""}`,
	} {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if stored := homerun.ReadStoredConfig(); stored != nil {
			t.Errorf("%s: expected nil, got %+v", name, stored)
		}
	}
}

func TestAPIErrorMessage(t *testing.T) {
	if got := homerun.APIErrorMessage(422, []byte(`{"error":"bad"}`)); got != `422 Unprocessable Entity: {"error":"bad"}` {
		t.Errorf("JSON body should be kept verbatim, got %q", got)
	}

	got := homerun.APIErrorMessage(404, []byte("<html>nope</html>"))
	if !strings.Contains(got, "probably older than this CLI") {
		t.Errorf("a non-JSON 404 should blame the instance's age, got %q", got)
	}

	got = homerun.APIErrorMessage(500, []byte("<html>boom</html>"))
	if !strings.Contains(got, "non-JSON body") {
		t.Errorf("a non-JSON error should say so, got %q", got)
	}
}

func TestFindingsAtOrAboveCountsDownToTheLevel(t *testing.T) {
	counts := cli.SeverityCounts{Critical: 1, High: 2, Medium: 4, Low: 8, Unknown: 16}

	for level, want := range map[string]int{
		"critical": 1,
		"high":     3,
		"medium":   7,
		"low":      15,
	} {
		if got := cli.FindingsAtOrAbove(counts, level); got != want {
			t.Errorf("--fail-on %s: want %d, got %d", level, want, got)
		}
	}
}

func TestRevisionRowMarkersAndShortening(t *testing.T) {
	row := cli.RevisionRow(cli.Revision{
		Current:     true,
		GitCommit:   "0123456789abcdef",
		ID:          "rev-1",
		ImageDigest: "sha256:0123456789abcdef0123456789",
		Retained:    true,
	})
	if row["commit"] != "0123456" {
		t.Errorf("commit should be shortened to 7, got %q", row["commit"])
	}
	if len(row["digest"]) != 19 {
		t.Errorf("digest should be shortened to 19, got %q", row["digest"])
	}
	if row["marker"] != "current" {
		t.Errorf("want current, got %q", row["marker"])
	}

	row = cli.RevisionRow(cli.Revision{Previous: true, Retained: false})
	if row["marker"] != "previous (not retained)" {
		t.Errorf("a dropped image should say so, got %q", row["marker"])
	}
	row = cli.RevisionRow(cli.Revision{Retained: false})
	if row["marker"] != "(not retained)" {
		t.Errorf("an unmarked revision keeps only the retention note, got %q", row["marker"])
	}
}

func TestInstanceStatusText(t *testing.T) {
	unreachable := cli.InstanceStatusText(cli.InstanceUpdateStatus{Current: "1.0.0"})
	if !strings.Contains(unreachable, "unknown (couldn't reach GitHub)") {
		t.Errorf("no latest release should say so, got %q", unreachable)
	}

	status := cli.InstanceUpdateStatus{Channel: "canary", Current: "1.0.0", UpdateAvailable: true}
	status.Latest = &struct {
		Version string `json:"version"`
	}{Version: "1.1.0"}
	status.Preflight.Ready = true
	if !strings.Contains(cli.InstanceStatusText(status), "Channel:  canary") {
		t.Errorf("the channel should be shown, got %q", cli.InstanceStatusText(status))
	}
	if !strings.Contains(cli.InstanceStatusText(status), "run `homerun instance update`") {
		t.Errorf("a ready update should point at the command, got %q", cli.InstanceStatusText(status))
	}

	status.Preflight.Ready = false
	status.Preflight.Reason = "a deploy is running"
	if !strings.Contains(cli.InstanceStatusText(status), "a deploy is running") {
		t.Errorf("a blocked update should carry the reason, got %q", cli.InstanceStatusText(status))
	}

	status.Preflight.Reason = ""
	if !strings.Contains(cli.InstanceStatusText(status), "unknown reason") {
		t.Errorf("a blocked update with no reason still explains itself, got %q", cli.InstanceStatusText(status))
	}
}

func TestPrintPageFooterOnlyWhenTruncated(t *testing.T) {
	header := http.Header{}
	header.Set("x-total-count", "10")
	header.Set("x-page", "1")
	header.Set("x-per-page", "4")

	if got := captureStdout(t, func() { cli.PrintPageFooter(header, 4) }); !strings.Contains(got, "page 1 of 3") {
		t.Errorf("a truncated page should say how much is left, got %q", got)
	}
	if got := captureStdout(t, func() { cli.PrintPageFooter(header, 10) }); got != "" {
		t.Errorf("a complete listing needs no footer, got %q", got)
	}
	if got := captureStdout(t, func() { cli.PrintPageFooter(http.Header{}, 4) }); got != "" {
		t.Errorf("no pagination headers means no footer, got %q", got)
	}
}

func TestPrintTable(t *testing.T) {
	out := captureStdout(t, func() {
		cli.PrintTable([]map[string]string{{"id": "a", "name": "alpha"}, {"id": "bb"}}, []string{"id", "name"})
	})
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("want header, rule and two rows, got %q", out)
	}
	if lines[0] != "id  name" {
		t.Errorf("header should be padded to the widest cell, got %q", lines[0])
	}
	if lines[1] != "--  -----" {
		t.Errorf("rule should match the column widths, got %q", lines[1])
	}
	if lines[3] != "bb" {
		t.Errorf("a missing cell should print blank, got %q", lines[3])
	}

	if got := captureStdout(t, func() { cli.PrintTable(nil, []string{"id"}) }); got != "(none)\n" {
		t.Errorf("an empty listing should say (none), got %q", got)
	}
}

func TestSplitGlobalFlagsAnywhereInTheArgs(t *testing.T) {
	global, rest := cli.SplitGlobalFlags([]string{
		"services", "list", "--base-url", "https://example.com", "--json", "--api-key=k",
	})
	if global.BaseURL != "https://example.com" || global.APIKey != "k" {
		t.Errorf("globals should be picked up after the subcommand, got %+v", global)
	}
	if strings.Join(rest, " ") != "services list --json" {
		t.Errorf("everything else should keep its order, got %v", rest)
	}
}

func TestParseAcceptsFlagsAfterPositionals(t *testing.T) {
	set := cli.NewFlagSet("test")
	options := cli.ListFlags(set)
	positionals := cli.Parse(set, []string{"an-id", "--json", "--per-page", "5"})

	if strings.Join(positionals, ",") != "an-id" {
		t.Errorf("positionals lost: %v", positionals)
	}
	if !options.JSON || options.PerPage != 5 {
		t.Errorf("flags after a positional should still parse, got %+v", options)
	}
}

func TestListQuery(t *testing.T) {
	query := cli.ListQuery(cli.ListArgs{Page: 2, PerPage: 50, Search: "web"})
	if query.Get("page") != "2" || query.Get("perPage") != "50" || query.Get("q") != "web" {
		t.Errorf("unexpected query %v", query)
	}
	if len(cli.ListQuery(cli.ListArgs{})) != 0 {
		t.Errorf("unset options should send nothing, got %v", cli.ListQuery(cli.ListArgs{}))
	}
}

// captureStdout runs fn with stdout redirected to a pipe and returns what it printed.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = write
	done := make(chan string)
	go func() {
		var builder strings.Builder
		buffer := make([]byte, 4096)
		for {
			n, err := read.Read(buffer)
			builder.Write(buffer[:n])
			if err != nil {
				break
			}
		}
		done <- builder.String()
	}()
	fn()
	write.Close()
	os.Stdout = original
	return <-done
}

// --- helpers -------------------------------------------------------------

// cliExit is what the swapped-in fail panics with instead of exiting.
type cliExit struct{ message string }

// runCLI runs fn with fail swapped for a panic, returning what it printed on
// stdout and the message it failed with, "" when it ran to completion.
func runCLI(t *testing.T, fn func()) (string, string) {
	t.Helper()
	original := cli.Fail
	cli.Fail = func(message string) { panic(cliExit{message}) }
	t.Cleanup(func() { cli.Fail = original })

	failed := ""
	out := captureStdout(t, func() {
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			exit, ok := recovered.(cliExit)
			if !ok {
				panic(recovered)
			}
			failed = exit.message
		}()
		fn()
	})
	return out, failed
}

// noSleep drops the poll delay so a wait loop under test runs at full speed.
func noSleep(t *testing.T) {
	t.Helper()
	original := cli.Sleep
	cli.Sleep = func(time.Duration) {}
	t.Cleanup(func() { cli.Sleep = original })
}

// seenRequest is one request a fake instance received.
type seenRequest struct {
	Header http.Header
	Method string
	Path   string
	Query  url.Values
	Body   string
}

// fakeAPI starts a stub instance and returns a client pointed at it plus the
// requests it received, in order.
func fakeAPI(t *testing.T, handler http.HandlerFunc) (*cli.Client, *[]seenRequest) {
	t.Helper()
	seen := &[]seenRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		*seen = append(*seen, seenRequest{
			Header: request.Header.Clone(),
			Method: request.Method,
			Path:   request.URL.Path,
			Query:  request.URL.Query(),
			Body:   string(body),
		})
		handler(writer, request)
	}))
	t.Cleanup(server.Close)
	return cli.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL}), seen
}

// jsonAPI is a fake instance that answers every request with the same JSON body.
func jsonAPI(t *testing.T, body string) (*cli.Client, *[]seenRequest) {
	t.Helper()
	return fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("content-type", "application/json")
		fmt.Fprint(writer, body)
	})
}

// deadServerURL is the URL of a server that has already shut down, i.e. the
// address of a transport failure that needs no real network.
func deadServerURL(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	server.Close()
	return server.URL
}

// isolate points HOME at an empty temp dir and clears the env overrides, so
// nothing under test can read the developer's real login.
func isolate(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("HOMERUN_BASE_URL", "")
	t.Setenv("HOMERUN_API_KEY", "")
}

// --- services ------------------------------------------------------------

func TestServicesListTable(t *testing.T) {
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("x-total-count", "3")
		writer.Header().Set("x-page", "1")
		writer.Header().Set("x-per-page", "1")
		fmt.Fprint(writer, `[{"currentStatus":"running","id":"svc-1","image":"nginx","name":"Web","slug":"web","tag":"1.27"}]`)
	})

	out, failed := runCLI(t, func() { cli.ServicesList(client, cli.ListArgs{Page: 2, Search: "web"}) })
	if failed != "" {
		t.Fatalf("listing should have succeeded, failed with %q", failed)
	}
	if !strings.Contains(out, "nginx:1.27") {
		t.Errorf("image and tag should be joined, got %q", out)
	}
	if !strings.Contains(out, "Showing 1 of 3 (page 1 of 3)") {
		t.Errorf("a truncated page should carry the footer, got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/services" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}
	if (*seen)[0].Query.Get("page") != "2" || (*seen)[0].Query.Get("q") != "web" {
		t.Errorf("list options should reach the API, got %v", (*seen)[0].Query)
	}
	if (*seen)[0].Header.Get("x-api-key") != "k" {
		t.Errorf("the API key should be sent as x-api-key, got %q", (*seen)[0].Header.Get("x-api-key"))
	}
}

func TestServicesListJSONPrintsTheBodyVerbatim(t *testing.T) {
	client, _ := jsonAPI(t, `[{"id":"svc-1","slug":"web"}]`)

	out, failed := runCLI(t, func() { cli.ServicesList(client, cli.ListArgs{JSON: true}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, `"slug": "web"`) {
		t.Errorf("--json should re-indent the raw body, got %q", out)
	}
	if strings.Contains(out, "id  ") {
		t.Errorf("--json should not print a table, got %q", out)
	}
}

func TestServicesListRejectsAnUnexpectedShape(t *testing.T) {
	client, _ := jsonAPI(t, `{"not":"a list"}`)

	if _, failed := runCLI(t, func() { cli.ServicesList(client, cli.ListArgs{}) }); failed == "" {
		t.Error("a body that isn't a list of services should fail")
	}
}

func TestServiceGet(t *testing.T) {
	client, seen := jsonAPI(t, `{"id":"svc 1","name":"Web"}`)

	out, failed := runCLI(t, func() { cli.ServiceGet(client, "svc 1") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, `"name": "Web"`) {
		t.Errorf("got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/services/svc 1" {
		t.Errorf("the id should be path-escaped into the URL, got %q", (*seen)[0].Path)
	}
}

func TestServiceActionHitsThePerActionEndpoint(t *testing.T) {
	for _, action := range []string{"deploy", "start", "stop", "restart"} {
		t.Run(action, func(t *testing.T) {
			client, seen := jsonAPI(t, `{"ok":true}`)

			out, failed := runCLI(t, func() { cli.ServiceAction(client, action, "svc-1") })
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if !strings.Contains(out, `"ok": true`) {
				t.Errorf("the API's answer should be printed, got %q", out)
			}
			if (*seen)[0].Method != "POST" {
				t.Errorf("want POST, got %s", (*seen)[0].Method)
			}
			if want := "/api/v1/services/svc-1/" + action; (*seen)[0].Path != want {
				t.Errorf("want %s, got %s", want, (*seen)[0].Path)
			}
		})
	}
}

func TestServiceDelete(t *testing.T) {
	for name, force := range map[string]bool{"plain": false, "forced": true} {
		t.Run(name, func(t *testing.T) {
			client, seen := jsonAPI(t, `{}`)

			out, failed := runCLI(t, func() { cli.ServiceDelete(client, "svc-1", force) })
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if !strings.Contains(out, `"deleted": true`) || !strings.Contains(out, `"id": "svc-1"`) {
				t.Errorf("delete should confirm what it deleted, got %q", out)
			}
			if (*seen)[0].Method != "DELETE" {
				t.Errorf("want DELETE, got %s", (*seen)[0].Method)
			}
			got := (*seen)[0].Query.Get("force")
			if force && got != "true" {
				t.Errorf("--force should be sent, got query %v", (*seen)[0].Query)
			}
			if !force && got != "" {
				t.Errorf("without --force nothing should be sent, got query %v", (*seen)[0].Query)
			}
		})
	}
}

func TestServiceDeleteSurfacesTheAPIError(t *testing.T) {
	client, _ := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(409)
		fmt.Fprint(writer, `{"error":"container still running"}`)
	})

	_, failed := runCLI(t, func() { cli.ServiceDelete(client, "svc-1", false) })
	if !strings.Contains(failed, "409") || !strings.Contains(failed, "container still running") {
		t.Errorf("the API's 409 should be reported verbatim, got %q", failed)
	}
}

func TestServiceWebhook(t *testing.T) {
	client, seen := jsonAPI(t, `{"secret":"s","url":"https://example.com/hook"}`)

	out, failed := runCLI(t, func() { cli.ServiceWebhook(client, "svc-1") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "https://example.com/hook") {
		t.Errorf("got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/services/svc-1/webhook" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}
}

func TestRevisionsList(t *testing.T) {
	body := `[{"createdAt":"2026-01-01","current":true,"gitCommit":"0123456789","health":"healthy",` +
		`"id":"rev-1","imageDigest":"sha256:abcdef0123456789abcd","imageRef":"nginx:1.27","retained":true}]`
	client, seen := jsonAPI(t, body)

	out, failed := runCLI(t, func() { cli.RevisionsList(client, "svc-1", false) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "0123456") || !strings.Contains(out, "current") {
		t.Errorf("the table should carry the shortened commit and the marker, got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/services/svc-1/revisions" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}

	out, failed = runCLI(t, func() { cli.RevisionsList(client, "svc-1", true) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, `"imageDigest": "sha256:abcdef0123456789abcd"`) {
		t.Errorf("--json should not shorten anything, got %q", out)
	}
}

func TestServiceLogsStreamsToStdout(t *testing.T) {
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, "line one\nline two\n")
	})

	out, failed := runCLI(t, func() { cli.ServiceLogs(client, "svc-1", true, 50) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if out != "line one\nline two\n" {
		t.Errorf("the stream should land on stdout untouched, got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/services/svc-1/logs" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}
	if (*seen)[0].Query.Get("tail") != "50" || (*seen)[0].Query.Get("follow") != "true" {
		t.Errorf("--tail/--follow should reach the API, got %v", (*seen)[0].Query)
	}
}

func TestServiceLogsWithoutOptionsSendsNoQuery(t *testing.T) {
	client, seen := fakeAPI(t, func(http.ResponseWriter, *http.Request) {})

	if _, failed := runCLI(t, func() { cli.ServiceLogs(client, "svc-1", false, 0) }); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if len((*seen)[0].Query) != 0 {
		t.Errorf("defaults belong to the API, got %v", (*seen)[0].Query)
	}
}

func TestServiceLogsReportsTheAPIError(t *testing.T) {
	client, _ := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(400)
		fmt.Fprint(writer, `{"error":"never deployed"}`)
	})

	_, failed := runCLI(t, func() { cli.ServiceLogs(client, "svc-1", false, 0) })
	if !strings.Contains(failed, "400") || !strings.Contains(failed, "never deployed") {
		t.Errorf("got %q", failed)
	}
}

func TestServiceLogsReportsATransportFailure(t *testing.T) {
	client := cli.NewClient(homerun.Config{APIKey: "k", BaseURL: deadServerURL(t)})

	if _, failed := runCLI(t, func() { cli.ServiceLogs(client, "svc-1", false, 0) }); failed == "" {
		t.Error("an unreachable instance should fail")
	}
}

func TestServiceRollback(t *testing.T) {
	tests := []struct {
		name          string
		revisionID    string
		restoreConfig bool
		wantPath      string
		wantRestore   string
	}{
		{"defaults to the previous revision", "", false, "/api/v1/services/svc-1/revisions/previous/deploy", ""},
		{"explicit revision", "rev-9", false, "/api/v1/services/svc-1/revisions/rev-9/deploy", ""},
		{"restores the config too", "rev-9", true, "/api/v1/services/svc-1/revisions/rev-9/deploy", "true"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, seen := jsonAPI(t, `{"ok":true}`)

			out, failed := runCLI(t, func() {
				cli.ServiceRollback(client, "svc-1", test.revisionID, test.restoreConfig)
			})
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if !strings.Contains(out, `"ok": true`) {
				t.Errorf("got %q", out)
			}
			if (*seen)[0].Method != "POST" {
				t.Errorf("want POST, got %s", (*seen)[0].Method)
			}
			if (*seen)[0].Path != test.wantPath {
				t.Errorf("want %s, got %s", test.wantPath, (*seen)[0].Path)
			}
			if got := (*seen)[0].Query.Get("restoreConfig"); got != test.wantRestore {
				t.Errorf("want restoreConfig %q, got %q", test.wantRestore, got)
			}
		})
	}
}

// --- scans ---------------------------------------------------------------

func TestScansList(t *testing.T) {
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("x-total-count", "5")
		writer.Header().Set("x-page", "1")
		writer.Header().Set("x-per-page", "1")
		fmt.Fprint(writer, `[{"counts":{"critical":2,"high":1,"medium":0,"low":3,"unknown":0},`+
			`"id":"scan-1","imageRef":"nginx:1.27","scannedAt":"2026-01-01","status":"succeeded"}]`)
	})

	out, failed := runCLI(t, func() { cli.ScansList(client, "svc-1", cli.ListArgs{PerPage: 1}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "scan-1") || !strings.Contains(out, "nginx:1.27") {
		t.Errorf("got %q", out)
	}
	if !strings.Contains(out, "Showing 1 of 5") {
		t.Errorf("a truncated listing should say so, got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/services/svc-1/scans" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}
	if (*seen)[0].Query.Get("perPage") != "1" {
		t.Errorf("--per-page should reach the API, got %v", (*seen)[0].Query)
	}

	out, failed = runCLI(t, func() { cli.ScansList(client, "svc-1", cli.ListArgs{JSON: true}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, `"critical": 2`) {
		t.Errorf("--json should print the raw body, got %q", out)
	}
}

func TestScanGet(t *testing.T) {
	for name, scanID := range map[string]string{"latest": "latest", "by id": "scan-9"} {
		t.Run(name, func(t *testing.T) {
			client, seen := jsonAPI(t, `{"counts":{"critical":1},"id":"scan-9","imageRef":"nginx:1.27",`+
				`"scannedAt":"2026-01-01","status":"succeeded","totalFindings":1,`+
				`"findings":[{"id":"CVE-1","installedVersion":"1.0","pkg":"zlib","severity":"critical","title":"boom"}]}`)

			var scan cli.ImageScan
			out, failed := runCLI(t, func() { scan = cli.ScanGet(client, "svc-1", scanID, false) })
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if scan.ID != "scan-9" || scan.Counts.Critical != 1 {
				t.Errorf("the scan should be returned for --fail-on to check, got %+v", scan)
			}
			if !strings.Contains(out, "CVE-1") || !strings.Contains(out, "1 critical") {
				t.Errorf("got %q", out)
			}
			if want := "/api/v1/services/svc-1/scans/" + scanID; (*seen)[0].Path != want {
				t.Errorf("want %s, got %s", want, (*seen)[0].Path)
			}
		})
	}
}

func TestScanGetJSONSkipsTheSummary(t *testing.T) {
	client, _ := jsonAPI(t, `{"id":"scan-9","status":"succeeded"}`)

	out, failed := runCLI(t, func() { cli.ScanGet(client, "svc-1", "latest", true) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if strings.Contains(out, "Findings:") {
		t.Errorf("--json should not print the summary, got %q", out)
	}
	if !strings.Contains(out, `"id": "scan-9"`) {
		t.Errorf("got %q", out)
	}
}

func TestPrintScanNotesTruncationAndErrors(t *testing.T) {
	scan := cli.ImageScan{
		Counts:        cli.SeverityCounts{Critical: 1, Unknown: 2},
		Digest:        "sha256:abc",
		Error:         "trivy died",
		ID:            "scan-1",
		ImageRef:      "nginx:1.27",
		ScannedAt:     "2026-01-01",
		Status:        "failed",
		TotalFindings: 40,
		Findings:      []cli.ScanFinding{{ID: "CVE-1", Pkg: "zlib", Severity: "critical", Title: "boom"}},
	}

	out, _ := runCLI(t, func() { cli.PrintScan(scan) })
	for _, want := range []string{
		"Scan scan-1 (failed, 2026-01-01)",
		"Image:    nginx:1.27",
		"Digest:   sha256:abc",
		"1 critical, 0 high, 0 medium, 0 low, 2 unknown",
		"Error:    trivy died",
		"Showing 1 of 40 findings, most severe first.",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}

	scan.Digest, scan.Error, scan.TotalFindings = "", "", 1
	out, _ = runCLI(t, func() { cli.PrintScan(scan) })
	if strings.Contains(out, "Digest:") || strings.Contains(out, "Error:") {
		t.Errorf("empty fields should be left out, got %q", out)
	}
	if strings.Contains(out, "Showing 1 of") {
		t.Errorf("a complete findings list needs no note, got %q", out)
	}
}

func TestQueueScan(t *testing.T) {
	t.Run("queued", func(t *testing.T) {
		client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(writer, `{"jobId":"job-1"}`)
		})
		jobID := ""
		if _, failed := runCLI(t, func() { jobID = cli.QueueScan(client, "svc-1", false) }); failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if jobID != "job-1" {
			t.Errorf("want job-1, got %q", jobID)
		}
		if (*seen)[0].Method != "POST" || (*seen)[0].Path != "/api/v1/services/svc-1/scans" {
			t.Errorf("wrong request %+v", (*seen)[0])
		}
	})

	t.Run("409 is reused when waiting", func(t *testing.T) {
		client, _ := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(409)
			fmt.Fprint(writer, `{"error":"already scanning","jobId":"job-7"}`)
		})
		jobID := ""
		if _, failed := runCLI(t, func() { jobID = cli.QueueScan(client, "svc-1", true) }); failed != "" {
			t.Fatalf("a scan already in flight should be joined, failed with %q", failed)
		}
		if jobID != "job-7" {
			t.Errorf("want the in-flight job, got %q", jobID)
		}
	})

	t.Run("409 fails without wait", func(t *testing.T) {
		client, _ := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(409)
			fmt.Fprint(writer, `{"error":"already scanning","jobId":"job-7"}`)
		})
		if _, failed := runCLI(t, func() { cli.QueueScan(client, "svc-1", false) }); !strings.Contains(failed, "409") {
			t.Errorf("want the 409 reported, got %q", failed)
		}
	})

	t.Run("transport failure", func(t *testing.T) {
		client := cli.NewClient(homerun.Config{APIKey: "k", BaseURL: deadServerURL(t)})
		if _, failed := runCLI(t, func() { cli.QueueScan(client, "svc-1", true) }); failed == "" {
			t.Error("an unreachable instance should fail")
		}
	})
}

func TestWaitForJobPollsUntilTerminal(t *testing.T) {
	noSleep(t)
	polls := 0
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		polls++
		if polls < 3 {
			fmt.Fprint(writer, `{"status":"running"}`)
			return
		}
		fmt.Fprint(writer, `{"error":"boom","status":"failed"}`)
	})

	status, jobError := "", ""
	if _, failed := runCLI(t, func() {
		status, jobError = cli.WaitForJob(client, "job-1", time.Millisecond, time.Minute)
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if status != "failed" || jobError != "boom" {
		t.Errorf("want the terminal status and its error, got %q/%q", status, jobError)
	}
	if polls != 3 {
		t.Errorf("want 3 polls, got %d", polls)
	}
	if (*seen)[0].Path != "/api/v1/jobs/job-1" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}
}

func TestWaitForJobGivesUp(t *testing.T) {
	noSleep(t)
	client, _ := jsonAPI(t, `{"status":"running"}`)

	_, failed := runCLI(t, func() { cli.WaitForJob(client, "job-1", time.Millisecond, -time.Second) })
	if !strings.Contains(failed, "Timed out waiting for scan job job-1") {
		t.Errorf("got %q", failed)
	}
}

// scanAPI is a fake instance covering the whole `services scan --wait` path:
// queue, poll once, then hand back the latest scan.
func scanAPI(t *testing.T, jobStatus, scanBody string) (*cli.Client, *[]seenRequest) {
	t.Helper()
	return fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case strings.HasPrefix(request.URL.Path, "/api/v1/jobs/"):
			fmt.Fprintf(writer, `{"status":%q}`, jobStatus)
		case strings.Contains(request.URL.Path, "/scans/"):
			fmt.Fprint(writer, scanBody)
		default:
			fmt.Fprint(writer, `{"jobId":"job-1"}`)
		}
	})
}

func TestServiceScanWithoutWaitPrintsTheJobID(t *testing.T) {
	client, _ := jsonAPI(t, `{"jobId":"job-1"}`)

	out, failed := runCLI(t, func() { cli.ServiceScan(client, "svc-1", cli.ScanArgs{}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, `"jobId": "job-1"`) || !strings.Contains(out, `"status": "queued"`) {
		t.Errorf("got %q", out)
	}
}

func TestServiceScanWaitsAndGatesOnFailOn(t *testing.T) {
	tests := []struct {
		name     string
		failOn   string
		critical int
		wantFail string
	}{
		{"clean run", "high", 0, ""},
		{"one finding", "critical", 1, "1 finding at or above CRITICAL (--fail-on critical)."},
		{"several findings", "high", 3, "3 findings at or above HIGH (--fail-on high)."},
		{"no gate", "", 9, ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			noSleep(t)
			body := fmt.Sprintf(
				`{"counts":{"critical":%d},"id":"scan-1","status":"succeeded","totalFindings":%d}`,
				test.critical, test.critical,
			)
			client, seen := scanAPI(t, "succeeded", body)

			_, failed := runCLI(t, func() {
				cli.ServiceScan(client, "svc-1", cli.ScanArgs{FailOn: test.failOn, Wait: true})
			})
			if failed != test.wantFail {
				t.Errorf("want %q, got %q", test.wantFail, failed)
			}
			if last := (*seen)[len(*seen)-1].Path; last != "/api/v1/services/svc-1/scans/latest" {
				t.Errorf("the wait should end on the latest scan, got %q", last)
			}
		})
	}
}

func TestServiceScanReportsAFailedJob(t *testing.T) {
	noSleep(t)
	client, _ := scanAPI(t, "cancelled", `{}`)

	_, failed := runCLI(t, func() { cli.ServiceScan(client, "svc-1", cli.ScanArgs{Wait: true}) })
	if failed != "Scan cancelled: no reason given" {
		t.Errorf("got %q", failed)
	}
}

// --- instance ------------------------------------------------------------

func TestInstanceStatus(t *testing.T) {
	client, seen := jsonAPI(t, `{"current":"1.0.0","latest":{"version":"1.1.0"},`+
		`"preflight":{"ready":true},"updateAvailable":true}`)

	out, failed := runCLI(t, func() { cli.InstanceStatus(client, false) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "Running:  v1.0.0") || !strings.Contains(out, "run `homerun instance update`") {
		t.Errorf("got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/instance/update" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}

	out, failed = runCLI(t, func() { cli.InstanceStatus(client, true) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, `"updateAvailable": true`) {
		t.Errorf("--json should print the raw body, got %q", out)
	}
}

func TestInstanceUpdateWaitsForTheNewVersion(t *testing.T) {
	noSleep(t)
	polls := 0
	client, _ := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == "POST" {
			fmt.Fprint(writer, `{"version":"1.2.0"}`)
			return
		}
		if request.URL.Path == "/api/v1/instance/update/progress" {
			writer.WriteHeader(502)
			return
		}
		polls++
		if polls < 2 {
			writer.WriteHeader(502)
			return
		}
		fmt.Fprint(writer, `{"current":"1.2.0"}`)
	})

	out, failed := runCLI(t, func() { cli.InstanceUpdate(client, true, time.Minute) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "Updating to v1.2.0.") {
		t.Errorf("got %q", out)
	}
	if strings.Count(out, "Waiting for Homerun to come back...") != 1 {
		t.Errorf("the restart should be announced once, got %q", out)
	}
	if !strings.Contains(out, "Homerun is now on v1.2.0.") {
		t.Errorf("the wait should end once the new version answers, got %q", out)
	}
	if polls != 2 {
		t.Errorf("a restarting instance should be polled again, got %d polls", polls)
	}
}

func TestInstanceUpdatePrintsTheHelperOutputOnce(t *testing.T) {
	noSleep(t)
	polls := 0
	client, _ := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == "POST" {
			fmt.Fprint(writer, `{"version":"1.2.0"}`)
			return
		}
		if request.URL.Path == "/api/v1/instance/update/progress" {
			polls++
			if polls == 1 {
				fmt.Fprint(writer, `{"state":"running","version":"1.2.0","log":["==> Pulling the new images"]}`)
				return
			}
			fmt.Fprint(writer, `{"state":"exited","exitCode":0,"version":"1.2.0","log":["==> Pulling the new images","==> Done"]}`)
			return
		}
		if polls < 2 {
			fmt.Fprint(writer, `{"current":"1.1.0"}`)
			return
		}
		fmt.Fprint(writer, `{"current":"1.2.0"}`)
	})

	out, failed := runCLI(t, func() { cli.InstanceUpdate(client, true, time.Minute) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if strings.Count(out, "Pulling the new images") != 1 || !strings.Contains(out, "==> Done") {
		t.Errorf("each helper line should print exactly once, got %q", out)
	}
}

func TestInstanceUpdateFailsWhenTheHelperFails(t *testing.T) {
	noSleep(t)
	client, _ := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == "POST" {
			fmt.Fprint(writer, `{"version":"1.2.0"}`)
			return
		}
		if request.URL.Path == "/api/v1/instance/update/progress" {
			fmt.Fprint(writer, `{"state":"exited","exitCode":1,"version":"1.2.0","log":["pull access denied"]}`)
			return
		}
		fmt.Fprint(writer, `{"current":"1.1.0"}`)
	})

	out, failed := runCLI(t, func() { cli.InstanceUpdate(client, true, time.Minute) })
	if !strings.Contains(out, "pull access denied") {
		t.Errorf("the helper's output should be shown, got %q", out)
	}
	if !strings.Contains(failed, "failed (exit 1)") {
		t.Errorf("got %q", failed)
	}
}

func TestInstanceUpdateWithoutWaitReturnsImmediately(t *testing.T) {
	client, seen := jsonAPI(t, `{"version":"1.2.0"}`)

	out, failed := runCLI(t, func() { cli.InstanceUpdate(client, false, 0) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if strings.Contains(out, "is now on") {
		t.Errorf("without --wait nothing should be polled, got %q", out)
	}
	if len(*seen) != 1 {
		t.Errorf("want one request, got %d", len(*seen))
	}
}

func TestInstanceUpdateGivesUp(t *testing.T) {
	noSleep(t)
	client, _ := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == "POST" {
			fmt.Fprint(writer, `{"version":"1.2.0"}`)
			return
		}
		fmt.Fprint(writer, `{"current":"1.1.0"}`)
	})

	_, failed := runCLI(t, func() { cli.InstanceUpdate(client, true, time.Nanosecond) })
	if !strings.Contains(failed, "Timed out waiting for v1.2.0") {
		t.Errorf("got %q", failed)
	}
}

func TestCurrentVersionOrEmptyToleratesAnUnhealthyInstance(t *testing.T) {
	t.Run("unreachable", func(t *testing.T) {
		client := cli.NewClient(homerun.Config{APIKey: "k", BaseURL: deadServerURL(t)})
		if got := cli.CurrentVersionOrEmpty(client); got != "" {
			t.Errorf("a restarting instance should read as empty, got %q", got)
		}
	})

	t.Run("500", func(t *testing.T) {
		client, _ := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(500)
			fmt.Fprint(writer, `{"error":"boom"}`)
		})
		if got := cli.CurrentVersionOrEmpty(client); got != "" {
			t.Errorf("want empty, got %q", got)
		}
	})

	t.Run("non-JSON body", func(t *testing.T) {
		client, _ := jsonAPI(t, "<html>starting up</html>")
		if got := cli.CurrentVersionOrEmpty(client); got != "" {
			t.Errorf("want empty, got %q", got)
		}
	})

	t.Run("healthy", func(t *testing.T) {
		client, _ := jsonAPI(t, `{"current":"1.2.0"}`)
		if got := cli.CurrentVersionOrEmpty(client); got != "1.2.0" {
			t.Errorf("want 1.2.0, got %q", got)
		}
	})
}

// --- stacks and templates ------------------------------------------------

func TestStacksList(t *testing.T) {
	client, seen := fakeAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("x-total-count", "4")
		writer.Header().Set("x-page", "2")
		writer.Header().Set("x-per-page", "1")
		fmt.Fprint(writer, `[{"id":"stk-1","name":"Blog","slug":"blog"}]`)
	})

	out, failed := runCLI(t, func() { cli.StacksList(client, cli.ListArgs{Page: 2}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "stk-1") || !strings.Contains(out, "blog") {
		t.Errorf("got %q", out)
	}
	if !strings.Contains(out, "page 2 of 4") {
		t.Errorf("the footer should carry the page, got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/stacks" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}

	out, failed = runCLI(t, func() { cli.StacksList(client, cli.ListArgs{JSON: true}) })
	if failed != "" || !strings.Contains(out, `"slug": "blog"`) {
		t.Errorf("--json should print the raw body, got %q / %q", out, failed)
	}
}

func TestTemplatesList(t *testing.T) {
	client, seen := jsonAPI(t, `[{"id":"tpl-1","image":"postgres","name":"Postgres","tag":"17"}]`)

	out, failed := runCLI(t, func() { cli.TemplatesList(client, cli.ListArgs{}) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "postgres:17") {
		t.Errorf("image and tag should be joined, got %q", out)
	}
	if (*seen)[0].Path != "/api/v1/templates" {
		t.Errorf("wrong path %q", (*seen)[0].Path)
	}

	out, failed = runCLI(t, func() { cli.TemplatesList(client, cli.ListArgs{JSON: true}) })
	if failed != "" || !strings.Contains(out, `"tag": "17"`) {
		t.Errorf("--json should print the raw body, got %q / %q", out, failed)
	}
}

// --- login ---------------------------------------------------------------

func TestPollForApprovalStoresTheKey(t *testing.T) {
	isolate(t)
	noSleep(t)
	home := os.Getenv("HOME")
	seen := ""
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		seen = string(body)
		fmt.Fprint(writer, `{"apiKey":"key-1","status":"approved"}`)
	}))
	t.Cleanup(server.Close)

	out, failed := runCLI(t, func() {
		cli.PollForApproval(server.URL, cli.DeviceStart{DeviceCode: "dc-1", ExpiresIn: 60, Interval: 1})
	})
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(seen, `"deviceCode":"dc-1"`) {
		t.Errorf("the poll should carry the device code, got %q", seen)
	}
	if !strings.Contains(out, "Logged in to "+server.URL) {
		t.Errorf("got %q", out)
	}

	stored := homerun.ReadStoredConfig()
	if stored == nil || stored.APIKey != "key-1" || stored.BaseURL != server.URL {
		t.Fatalf("the approved key should be stored, got %+v", stored)
	}
	info, err := os.Stat(filepath.Join(home, ".config", "homerun", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("a stored API key wants mode 0600, got %o", mode)
	}
}

func TestPollForApprovalFailures(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		body      string
		expiresIn int
		want      string
	}{
		{"denied", 200, `{"status":"denied"}`, 60, "Login request was denied."},
		{"expired", 200, `{"status":"expired"}`, 60, "Login request expired. Run `homerun login` again."},
		{"server error", 500, `{}`, 60, "Login failed: 500 Internal Server Error"},
		{"junk body", 200, `not json`, 60, "invalid character"},
		{"deadline already passed", 200, `{"status":"approved","apiKey":"k"}`, 0, "Timed out waiting for approval. Run `homerun login` again."},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			isolate(t)
			noSleep(t)
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				fmt.Fprint(writer, test.body)
			}))
			t.Cleanup(server.Close)

			_, failed := runCLI(t, func() {
				cli.PollForApproval(server.URL, cli.DeviceStart{DeviceCode: "dc-1", ExpiresIn: test.expiresIn})
			})
			if !strings.Contains(failed, test.want) {
				t.Errorf("want %q, got %q", test.want, failed)
			}
			if homerun.ReadStoredConfig() != nil {
				t.Error("a failed login should store nothing")
			}
		})
	}
}

func TestPollForApprovalKeepsPollingWhilePending(t *testing.T) {
	isolate(t)
	noSleep(t)
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		polls++
		if polls < 3 {
			fmt.Fprint(writer, `{"status":"pending"}`)
			return
		}
		fmt.Fprint(writer, `{"apiKey":"key-1","status":"approved"}`)
	}))
	t.Cleanup(server.Close)

	if _, failed := runCLI(t, func() {
		cli.PollForApproval(server.URL, cli.DeviceStart{DeviceCode: "dc-1", ExpiresIn: 60})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if polls != 3 {
		t.Errorf("want 3 polls, got %d", polls)
	}
}

func TestPollForApprovalReportsATransportFailure(t *testing.T) {
	isolate(t)
	noSleep(t)
	url := deadServerURL(t)

	_, failed := runCLI(t, func() {
		cli.PollForApproval(url, cli.DeviceStart{DeviceCode: "dc-1", ExpiresIn: 60})
	})
	if !strings.Contains(failed, "Login failed:") {
		t.Errorf("got %q", failed)
	}
}

func TestStartDeviceAuth(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		seenPath := ""
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			seenPath = request.URL.Path
			fmt.Fprint(writer, `{"deviceCode":"dc-1","expiresIn":600,"interval":5,"userCode":"ABCD-1234",`+
				`"verificationUri":"https://example.com/cli","verificationUriComplete":"https://example.com/cli?code=ABCD-1234"}`)
		}))
		t.Cleanup(server.Close)

		var start cli.DeviceStart
		if _, failed := runCLI(t, func() { start = cli.StartDeviceAuth(server.URL) }); failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if seenPath != "/api/v1/auth/cli/device" {
			t.Errorf("wrong path %q", seenPath)
		}
		if start.UserCode != "ABCD-1234" || start.Interval != 5 || start.DeviceCode != "dc-1" {
			t.Errorf("the device codes should be parsed, got %+v", start)
		}
	})

	t.Run("non-2xx", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(503)
		}))
		t.Cleanup(server.Close)

		_, failed := runCLI(t, func() { cli.StartDeviceAuth(server.URL) })
		if failed != "Couldn't start login: 503 Service Unavailable" {
			t.Errorf("got %q", failed)
		}
	})

	t.Run("unreachable", func(t *testing.T) {
		url := deadServerURL(t)
		_, failed := runCLI(t, func() { cli.StartDeviceAuth(url) })
		if !strings.Contains(failed, "Couldn't reach "+url) {
			t.Errorf("got %q", failed)
		}
	})
}

func TestResolveLoginBaseURL(t *testing.T) {
	isolate(t)

	if got := cli.ResolveLoginBaseURL("https://flag.example.com/"); got != "https://flag.example.com" {
		t.Errorf("the flag should win and lose its trailing slash, got %q", got)
	}

	withStdin(t, "https://typed.example.com\n")
	got := ""
	out, failed := runCLI(t, func() { got = cli.ResolveLoginBaseURL("") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if got != "https://typed.example.com" {
		t.Errorf("without a flag the answer should come from the prompt, got %q", got)
	}
	if !strings.Contains(out, "Homerun instance URL") {
		t.Errorf("the prompt should be printed, got %q", out)
	}
}

func TestResolveLoginBaseURLFallsBackToTheStoredOne(t *testing.T) {
	isolate(t)
	if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "k", BaseURL: "https://stored.example.com"}); err != nil {
		t.Fatal(err)
	}
	withStdin(t, "\n")

	got := ""
	out, failed := runCLI(t, func() { got = cli.ResolveLoginBaseURL("") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if got != "https://stored.example.com" {
		t.Errorf("an empty answer should keep the stored URL, got %q", got)
	}
	if !strings.Contains(out, "(https://stored.example.com)") {
		t.Errorf("the stored URL should be offered as the default, got %q", out)
	}
}

func TestResolveLoginBaseURLNeedsAnAnswer(t *testing.T) {
	isolate(t)
	withStdin(t, "")

	_, failed := runCLI(t, func() { cli.ResolveLoginBaseURL("") })
	if !strings.Contains(failed, "A base URL is required") {
		t.Errorf("got %q", failed)
	}
}

// withStdin points os.Stdin at a pipe holding input, for the login prompt.
func withStdin(t *testing.T, input string) {
	t.Helper()
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		_, _ = io.WriteString(write, input)
		write.Close()
	}()
	original := os.Stdin
	os.Stdin = read
	t.Cleanup(func() { os.Stdin = original; read.Close() })
}

func TestRevokeAPIKey(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		var seen seenRequest
		server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
			seen = seenRequest{Header: request.Header.Clone(), Method: request.Method, Path: request.URL.Path}
		}))
		t.Cleanup(server.Close)

		if !cli.RevokeAPIKey(homerun.StoredConfig{APIKey: "k", BaseURL: server.URL}) {
			t.Error("a 200 should count as revoked")
		}
		if seen.Method != "DELETE" || seen.Path != "/api/v1/auth-token" {
			t.Errorf("wrong request %+v", seen)
		}
		if seen.Header.Get("x-api-key") != "k" {
			t.Errorf("the key being revoked should authenticate the call, got %q", seen.Header.Get("x-api-key"))
		}
	})

	t.Run("rejected", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(401)
		}))
		t.Cleanup(server.Close)

		if cli.RevokeAPIKey(homerun.StoredConfig{APIKey: "k", BaseURL: server.URL}) {
			t.Error("a 401 is not a revocation")
		}
	})

	t.Run("unreachable", func(t *testing.T) {
		if cli.RevokeAPIKey(homerun.StoredConfig{APIKey: "k", BaseURL: deadServerURL(t)}) {
			t.Error("an unreachable instance is not a revocation")
		}
	})
}

func TestLogout(t *testing.T) {
	t.Run("nothing stored", func(t *testing.T) {
		isolate(t)
		out, failed := runCLI(t, cli.Logout)
		if failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if out != "Not logged in.\n" {
			t.Errorf("got %q", out)
		}
	})

	t.Run("revoked", func(t *testing.T) {
		isolate(t)
		server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
		t.Cleanup(server.Close)
		if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "k", BaseURL: server.URL}); err != nil {
			t.Fatal(err)
		}

		out, failed := runCLI(t, cli.Logout)
		if failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if !strings.Contains(out, "revoked the API key") {
			t.Errorf("got %q", out)
		}
		if homerun.ReadStoredConfig() != nil {
			t.Error("the local config should be gone")
		}
	})

	t.Run("clears the config even when the instance is unreachable", func(t *testing.T) {
		isolate(t)
		if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "k", BaseURL: deadServerURL(t)}); err != nil {
			t.Fatal(err)
		}

		out, failed := runCLI(t, cli.Logout)
		if failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if !strings.Contains(out, "Couldn't revoke the API key") {
			t.Errorf("got %q", out)
		}
		if homerun.ReadStoredConfig() != nil {
			t.Error("an unreachable instance must not block the local logout")
		}
	})
}

// --- self-update ---------------------------------------------------------

func TestAssetSuffixMatchesThisPlatform(t *testing.T) {
	want, ok := map[string]string{"amd64": "amd64", "arm64": "arm64"}[runtime.GOARCH]
	if !ok {
		t.Skipf("no prebuilt binaries for %s", runtime.GOARCH)
	}
	if runtime.GOOS == "darwin" {
		want = "darwin-" + want
	}
	if got, failed := "", ""; true {
		_, failed = runCLI(t, func() { got = cli.AssetSuffix() })
		if failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if got != want {
			t.Errorf("want %q, got %q", want, got)
		}
	}
}

func TestLatestReleaseTag(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		seenPath := ""
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			seenPath = request.URL.Path
			fmt.Fprint(writer, `{"tag_name":"v1.2.3"}`)
		}))
		t.Cleanup(server.Close)
		stubGitHub(t, server.URL, server.URL)

		tag := ""
		if _, failed := runCLI(t, func() { tag = cli.LatestReleaseTag() }); failed != "" {
			t.Fatalf("failed with %q", failed)
		}
		if tag != "v1.2.3" {
			t.Errorf("want v1.2.3, got %q", tag)
		}
		if seenPath != "/repos/"+release.Repo+"/releases/latest" {
			t.Errorf("wrong path %q", seenPath)
		}
	})

	t.Run("non-2xx", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(403)
		}))
		t.Cleanup(server.Close)
		stubGitHub(t, server.URL, server.URL)

		_, failed := runCLI(t, func() { cli.LatestReleaseTag() })
		if failed != "Couldn't check for updates: 403 Forbidden" {
			t.Errorf("got %q", failed)
		}
	})

	t.Run("unreachable", func(t *testing.T) {
		url := deadServerURL(t)
		stubGitHub(t, url, url)

		_, failed := runCLI(t, func() { cli.LatestReleaseTag() })
		if !strings.Contains(failed, "Couldn't check for updates:") {
			t.Errorf("got %q", failed)
		}
	})
}

// stubGitHub points the release endpoints at a fake server for one test.
func stubGitHub(t *testing.T, apiBase, downloadBase string) {
	t.Helper()
	originalAPI, originalDownload := release.APIBase, release.DownloadBase
	release.APIBase, release.DownloadBase = apiBase, downloadBase
	t.Cleanup(func() { release.APIBase, release.DownloadBase = originalAPI, originalDownload })
}

func TestDownloadReleaseUnpacksNextToTheBinary(t *testing.T) {
	payload := []byte("#!/bin/sh\necho homerun\n")
	seenPath := ""
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seenPath = request.URL.Path
		_, _ = writer.Write(gzipped(t, payload))
	}))
	t.Cleanup(server.Close)
	stubGitHub(t, server.URL, server.URL)

	dest := filepath.Join(t.TempDir(), "homerun")
	staged := ""
	if _, failed := runCLI(t, func() { staged = cli.DownloadRelease("v1.2.3", cli.AssetSuffix(), dest) }); failed != "" {
		t.Fatalf("failed with %q", failed)
	}

	if want := fmt.Sprintf("/%s/releases/download/v1.2.3/homerun-cli-%s.gz", release.Repo, cli.AssetSuffix()); seenPath != want {
		t.Errorf("want %q, got %q", want, seenPath)
	}
	if filepath.Dir(staged) != filepath.Dir(dest) {
		t.Errorf("the download should be staged beside the binary it replaces, got %q for dest %q", staged, dest)
	}
	got, err := os.ReadFile(staged)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Errorf("the asset should be un-gzipped, got %q", got)
	}
	info, err := os.Stat(staged)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o755 {
		t.Errorf("a replacement binary must be executable, got %o", mode)
	}
}

func TestDownloadReleaseFailures(t *testing.T) {
	t.Run("non-2xx", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(404)
		}))
		t.Cleanup(server.Close)
		stubGitHub(t, server.URL, server.URL)

		_, failed := runCLI(t, func() { cli.DownloadRelease("v1.2.3", cli.AssetSuffix(), filepath.Join(t.TempDir(), "homerun")) })
		if failed != "Download failed: 404 Not Found" {
			t.Errorf("got %q", failed)
		}
	})

	t.Run("not gzip", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(writer, "definitely not gzip")
		}))
		t.Cleanup(server.Close)
		stubGitHub(t, server.URL, server.URL)

		_, failed := runCLI(t, func() { cli.DownloadRelease("v1.2.3", cli.AssetSuffix(), filepath.Join(t.TempDir(), "homerun")) })
		if !strings.Contains(failed, "Download failed:") {
			t.Errorf("got %q", failed)
		}
	})

	t.Run("unreachable", func(t *testing.T) {
		url := deadServerURL(t)
		stubGitHub(t, url, url)

		_, failed := runCLI(t, func() { cli.DownloadRelease("v1.2.3", cli.AssetSuffix(), filepath.Join(t.TempDir(), "homerun")) })
		if !strings.Contains(failed, "Download failed:") {
			t.Errorf("got %q", failed)
		}
	})
}

// gzipped is the gzip stream a release asset is published as.
func gzipped(t *testing.T, payload []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// --- dispatch ------------------------------------------------------------

func TestRequireArg(t *testing.T) {
	if got := cli.RequireArg([]string{"a", "b"}, 1, "id"); got != "b" {
		t.Errorf("want b, got %q", got)
	}

	for name, args := range map[string][]string{"past the end": {"a"}, "empty": {"a", ""}} {
		_, failed := runCLI(t, func() { cli.RequireArg(args, 1, "id") })
		if !strings.Contains(failed, "missing <id>") {
			t.Errorf("%s: got %q", name, failed)
		}
	}
}

func TestRequireClientWithoutALogin(t *testing.T) {
	isolate(t)

	_, failed := runCLI(t, func() { cli.RequireClient("", "") })
	if !strings.Contains(failed, "Not logged in") {
		t.Errorf("got %q", failed)
	}

	if _, failed := runCLI(t, func() { cli.RequireClient("https://example.com", "k") }); failed != "" {
		t.Errorf("explicit flags are a login, failed with %q", failed)
	}
}

func TestRunScansDefaultsToList(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		wantPath string
		wantJSON bool
	}{
		{"bare id lists", []string{"svc-1"}, "/api/v1/services/svc-1/scans", false},
		{"explicit list", []string{"list", "svc-1", "--json"}, "/api/v1/services/svc-1/scans", true},
		{"get defaults to latest", []string{"get", "svc-1"}, "/api/v1/services/svc-1/scans/latest", false},
		{"get by id", []string{"get", "svc-1", "scan-9"}, "/api/v1/services/svc-1/scans/scan-9", false},
		{"get by id with a flag after it", []string{"get", "svc-1", "scan-9", "--json"}, "/api/v1/services/svc-1/scans/scan-9", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, seen := fakeAPI(t, func(writer http.ResponseWriter, request *http.Request) {
				if strings.HasSuffix(request.URL.Path, "/scans") {
					fmt.Fprint(writer, `[{"id":"scan-9","status":"succeeded"}]`)
					return
				}
				fmt.Fprint(writer, `{"id":"scan-9","status":"succeeded"}`)
			})

			out, failed := runCLI(t, func() { cli.RunScans(func() *cli.Client { return client }, test.args) })
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if (*seen)[0].Path != test.wantPath {
				t.Errorf("want %s, got %s", test.wantPath, (*seen)[0].Path)
			}
			if gotJSON := strings.Contains(out, `"status": "succeeded"`); gotJSON != test.wantJSON {
				t.Errorf("want --json %v, got output %q", test.wantJSON, out)
			}
		})
	}
}

func TestRunScansNeedsAnID(t *testing.T) {
	for name, args := range map[string][]string{"list": {"list"}, "get": {"get"}, "bare": {}} {
		_, failed := runCLI(t, func() {
			cli.RunScans(func() *cli.Client { return cli.NewClient(homerun.Config{BaseURL: "https://example.com"}) }, args)
		})
		if !strings.Contains(failed, "missing <id>") {
			t.Errorf("%s: got %q", name, failed)
		}
	}
}

func TestRunServiceScanValidatesFailOn(t *testing.T) {
	client := func() *cli.Client { return cli.NewClient(homerun.Config{BaseURL: "https://example.com"}) }

	_, failed := runCLI(t, func() { cli.RunServiceScan(client, []string{"svc-1", "--fail-on", "nope"}) })
	if !strings.Contains(failed, "--fail-on must be one of critical, high, medium, low") {
		t.Errorf("got %q", failed)
	}
}

func TestRunServiceScanImpliesWait(t *testing.T) {
	noSleep(t)
	client, seen := scanAPI(t, "succeeded", `{"counts":{},"id":"scan-1","status":"succeeded"}`)

	if _, failed := runCLI(t, func() {
		cli.RunServiceScan(func() *cli.Client { return client }, []string{"svc-1", "--fail-on", "critical"})
	}); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if len(*seen) < 3 {
		t.Errorf("--fail-on should imply --wait, only %d requests were made", len(*seen))
	}
}

func TestRunServicesDispatch(t *testing.T) {
	tests := []struct {
		name       string
		args       []string
		wantMethod string
		wantPath   string
	}{
		{"list", []string{"list"}, "GET", "/api/v1/services"},
		{"get", []string{"get", "svc-1"}, "GET", "/api/v1/services/svc-1"},
		{"deploy", []string{"deploy", "svc-1"}, "POST", "/api/v1/services/svc-1/deploy"},
		{"restart", []string{"restart", "svc-1"}, "POST", "/api/v1/services/svc-1/restart"},
		{"delete", []string{"delete", "svc-1", "--force"}, "DELETE", "/api/v1/services/svc-1"},
		{"webhook", []string{"webhook", "svc-1"}, "GET", "/api/v1/services/svc-1/webhook"},
		{"revisions", []string{"revisions", "svc-1", "--json"}, "GET", "/api/v1/services/svc-1/revisions"},
		{"logs", []string{"logs", "svc-1", "--tail", "10"}, "GET", "/api/v1/services/svc-1/logs"},
		{"rollback", []string{"rollback", "svc-1", "rev-2"}, "POST", "/api/v1/services/svc-1/revisions/rev-2/deploy"},
		{"scans", []string{"scans", "list", "svc-1"}, "GET", "/api/v1/services/svc-1/scans"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			isolate(t)
			seen := &[]seenRequest{}
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				*seen = append(*seen, seenRequest{Method: request.Method, Path: request.URL.Path})
				fmt.Fprint(writer, `[]`)
			}))
			t.Cleanup(server.Close)

			_, failed := runCLI(t, func() {
				cli.RunServices(cli.GlobalFlags{APIKey: "k", BaseURL: server.URL}, test.args)
			})
			if failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if len(*seen) == 0 {
				t.Fatal("no request was made")
			}
			if (*seen)[0].Method != test.wantMethod || (*seen)[0].Path != test.wantPath {
				t.Errorf("want %s %s, got %s %s",
					test.wantMethod, test.wantPath, (*seen)[0].Method, (*seen)[0].Path)
			}
		})
	}
}

func TestRunServicesRejectsBadInput(t *testing.T) {
	for name, test := range map[string]struct {
		args []string
		want string
	}{
		"no subcommand":      {nil, "missing services subcommand"},
		"unknown subcommand": {[]string{"frobnicate"}, `unknown services subcommand "frobnicate"`},
		"missing id":         {[]string{"get"}, "missing <id>"},
		"unknown flag":       {[]string{"list", "--nope"}, "flag provided but not defined"},
	} {
		t.Run(name, func(t *testing.T) {
			isolate(t)
			_, failed := runCLI(t, func() { cli.RunServices(cli.GlobalFlags{}, test.args) })
			if !strings.Contains(failed, test.want) {
				t.Errorf("want %q, got %q", test.want, failed)
			}
		})
	}
}

func TestRunStacksAndTemplates(t *testing.T) {
	for name, run := range map[string]func(cli.GlobalFlags, []string){
		"stacks":    cli.RunStacks,
		"templates": cli.RunTemplates,
	} {
		t.Run(name, func(t *testing.T) {
			isolate(t)
			seenPath := ""
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				seenPath = request.URL.Path
				fmt.Fprint(writer, `[]`)
			}))
			t.Cleanup(server.Close)

			if _, failed := runCLI(t, func() {
				run(cli.GlobalFlags{APIKey: "k", BaseURL: server.URL}, []string{"list", "--per-page", "5"})
			}); failed != "" {
				t.Fatalf("failed with %q", failed)
			}
			if seenPath != "/api/v1/"+name {
				t.Errorf("wrong path %q", seenPath)
			}

			for _, args := range [][]string{nil, {"delete"}} {
				_, failed := runCLI(t, func() { run(cli.GlobalFlags{}, args) })
				if !strings.Contains(failed, "usage: homerun "+name+" list") {
					t.Errorf("%v: got %q", args, failed)
				}
			}
		})
	}
}

func TestRunInstanceDispatch(t *testing.T) {
	isolate(t)
	seen := &[]seenRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		*seen = append(*seen, seenRequest{Method: request.Method, Path: request.URL.Path})
		fmt.Fprint(writer, `{"current":"1.0.0","version":"1.0.0"}`)
	}))
	t.Cleanup(server.Close)
	global := cli.GlobalFlags{APIKey: "k", BaseURL: server.URL}

	out, failed := runCLI(t, func() { cli.RunInstance(global, []string{"status", "--json"}) })
	if failed != "" || !strings.Contains(out, `"current": "1.0.0"`) {
		t.Errorf("status --json: %q / %q", out, failed)
	}
	if (*seen)[0].Method != "GET" {
		t.Errorf("status should be a GET, got %s", (*seen)[0].Method)
	}

	out, failed = runCLI(t, func() { cli.RunInstance(global, []string{"update"}) })
	if failed != "" || !strings.Contains(out, "Updating to v1.0.0.") {
		t.Errorf("update: %q / %q", out, failed)
	}
	if (*seen)[1].Method != "POST" {
		t.Errorf("update should be a POST, got %s", (*seen)[1].Method)
	}

	for name, test := range map[string]struct {
		args []string
		want string
	}{
		"no subcommand":      {nil, "usage: homerun instance status|update"},
		"unknown subcommand": {[]string{"reboot"}, `unknown instance subcommand "reboot"`},
	} {
		if _, failed := runCLI(t, func() { cli.RunInstance(global, test.args) }); !strings.Contains(failed, test.want) {
			t.Errorf("%s: got %q", name, failed)
		}
	}
}

func TestSplitGlobalFlagsNeedsAValue(t *testing.T) {
	_, failed := runCLI(t, func() { cli.SplitGlobalFlags([]string{"services", "--base-url"}) })
	if failed != "--base-url needs a value" {
		t.Errorf("got %q", failed)
	}
}

func TestMainDispatch(t *testing.T) {
	isolate(t)
	original := os.Args
	t.Cleanup(func() { os.Args = original })

	for name, args := range map[string][]string{
		"no args":      {"homerun"},
		"globals only": {"homerun", "--base-url", "https://example.com"},
	} {
		os.Args = args
		out, failed := runCLI(t, cli.Main)
		if failed != "" {
			t.Fatalf("%s: failed with %q", name, failed)
		}
		if !strings.Contains(out, "homerun - CLI for the Homerun REST API.") {
			t.Errorf("%s: want the usage block, got %q", name, out)
		}
	}

	os.Args = []string{"homerun", "frobnicate"}
	if _, failed := runCLI(t, cli.Main); !strings.Contains(failed, `unknown command "frobnicate"`) {
		t.Errorf("got %q", failed)
	}

	os.Args = []string{"homerun", "logout"}
	if out, failed := runCLI(t, cli.Main); failed != "" || out != "Not logged in.\n" {
		t.Errorf("logout should be dispatched, got %q / %q", out, failed)
	}
}

func TestLoginEndToEnd(t *testing.T) {
	isolate(t)
	noSleep(t)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/device") {
			fmt.Fprint(writer, `{"deviceCode":"dc-1","expiresIn":600,"interval":1,"userCode":"ABCD-1234",`+
				`"verificationUri":"https://example.com/cli","verificationUriComplete":"https://example.com/cli?code=ABCD-1234"}`)
			return
		}
		fmt.Fprint(writer, `{"apiKey":"key-1","status":"approved"}`)
	}))
	t.Cleanup(server.Close)

	out, failed := runCLI(t, func() { cli.Login(server.URL) })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	for _, want := range []string{
		"https://example.com/cli",
		"Code: ABCD-1234",
		"Waiting for approval...",
		"Logged in to " + server.URL,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}
	if stored := homerun.ReadStoredConfig(); stored == nil || stored.APIKey != "key-1" {
		t.Errorf("login should store the key, got %+v", stored)
	}
}

func TestSelfUpdateStopsWhenAlreadyCurrent(t *testing.T) {
	originalVersion := buildinfo.Version
	buildinfo.Version = "1.2.3"
	t.Cleanup(func() { buildinfo.Version = originalVersion })

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"tag_name":"v1.2.3"}`)
	}))
	t.Cleanup(server.Close)
	stubGitHub(t, server.URL, server.URL)

	out, failed := runCLI(t, func() { cli.SelfUpdate("stable") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "Already up to date (v1.2.3).") {
		t.Errorf("got %q", out)
	}
}

func TestSelfUpdateNeverDowngradesACanary(t *testing.T) {
	originalVersion := buildinfo.Version
	buildinfo.Version = "1.0.41-canary.5"
	t.Cleanup(func() { buildinfo.Version = originalVersion })

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"tag_name":"v1.0.40"}`)
	}))
	t.Cleanup(server.Close)
	stubGitHub(t, server.URL, server.URL)

	out, failed := runCLI(t, func() { cli.SelfUpdate("stable") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if !strings.Contains(out, "Already up to date (v1.0.41-canary.5, ahead of stable v1.0.40).") {
		t.Errorf("a canary ahead of stable must stay put, got %q", out)
	}
}

func TestLatestReleaseOnTheCanaryChannel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasSuffix(request.URL.Path, "/releases/tags/canary") {
			http.NotFound(writer, request)
			return
		}
		fmt.Fprint(writer, `{"name":"Canary 1.0.41-canary.7","tag_name":"canary"}`)
	}))
	t.Cleanup(server.Close)
	stubGitHub(t, server.URL, server.URL)

	var tag, version string
	if _, failed := runCLI(t, func() { tag, version = cli.LatestRelease("canary") }); failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	if tag != "canary" || version != "1.0.41-canary.7" {
		t.Errorf("got tag %q version %q", tag, version)
	}
	if _, failed := runCLI(t, func() { cli.LatestRelease("nightly") }); !strings.Contains(failed, "unknown channel") {
		t.Errorf("an unknown channel must be refused, got %q", failed)
	}
}

func TestInstanceChannelPatchesTheChannel(t *testing.T) {
	client, seen := jsonAPI(t, `{"channel":"canary"}`)
	out, failed := runCLI(t, func() { cli.InstanceChannel(client, "canary") })
	if failed != "" {
		t.Fatalf("failed with %q", failed)
	}
	request := (*seen)[0]
	if request.Method != http.MethodPatch || request.Path != "/api/v1/instance/update/channel" {
		t.Errorf("got %s %s", request.Method, request.Path)
	}
	if request.Body != `{"channel":"canary"}` || request.Header.Get("Content-Type") != "application/json" {
		t.Errorf("got body %q, content type %q", request.Body, request.Header.Get("Content-Type"))
	}
	if !strings.Contains(out, "Channel set to canary.") {
		t.Errorf("got %q", out)
	}

	if _, failed := runCLI(t, func() { cli.InstanceChannel(client, "nightly") }); !strings.Contains(failed, "unknown channel") {
		t.Errorf("an unknown channel must be refused before calling the API, got %q", failed)
	}
	if len(*seen) != 1 {
		t.Errorf("an unknown channel must not reach the API, saw %d requests", len(*seen))
	}
}

func TestPrintJSONFallsBackToTheRawBytes(t *testing.T) {
	out := captureStdout(t, func() { cli.PrintJSON([]byte("not json at all\n")) })
	if out != "not json at all\n" {
		t.Errorf("a non-JSON body should be printed as-is, got %q", out)
	}
}

func TestPrintValueFailsOnSomethingUnencodable(t *testing.T) {
	_, failed := runCLI(t, func() { cli.PrintValue(make(chan int)) })
	if !strings.Contains(failed, "unsupported type") {
		t.Errorf("got %q", failed)
	}
}

func TestConfigPathWithoutAHome(t *testing.T) {
	t.Setenv("HOME", "")
	if got := homerun.ConfigPath(); got != filepath.Join(".config", "homerun", "config.json") {
		t.Errorf("a missing home should fall back to a relative path, got %q", got)
	}
}

func TestWriteStoredConfigReportsAnUnusableHome(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	if err := os.WriteFile(home, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "k", BaseURL: "https://example.com"}); err == nil {
		t.Error("a home that isn't a directory should surface an error")
	}
}

func TestResolveConfigFillsTheGapsFromTheStoredLogin(t *testing.T) {
	isolate(t)
	if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "stored-key", BaseURL: "https://stored.example.com"}); err != nil {
		t.Fatal(err)
	}

	config := homerun.ResolveConfig("https://flag.example.com", "")
	if config == nil || config.BaseURL != "https://flag.example.com" || config.APIKey != "stored-key" {
		t.Fatalf("the flag should win and the key come from the store, got %+v", config)
	}

	t.Setenv("HOME", t.TempDir())
	if config := homerun.ResolveConfig("https://flag.example.com", ""); config != nil {
		t.Errorf("half a config is not a login, got %+v", config)
	}
}

func TestSplitGlobalFlagsAcceptsAnExplicitEmptyValue(t *testing.T) {
	global, rest := cli.SplitGlobalFlags([]string{"--api-key=", "services", "list"})

	if global.APIKey != "" {
		t.Errorf("an explicit empty value should stay empty, got %q", global.APIKey)
	}
	if strings.Join(rest, " ") != "services list" {
		t.Errorf("the subcommand must not be swallowed as the flag's value, got %v", rest)
	}

	global, rest = cli.SplitGlobalFlags([]string{"--base-url=", "services"})
	if global.BaseURL != "" || strings.Join(rest, " ") != "services" {
		t.Errorf("same for --base-url=, got %+v %v", global, rest)
	}
}

func TestShortenCutsOnRuneBoundaries(t *testing.T) {
	if got := cli.Shorten("héllo wörld", 7); got != "héllo w" {
		t.Errorf("a multi-byte character must not be cut in half, got %q", got)
	}
	if got := cli.Shorten("abc", 7); got != "abc" {
		t.Errorf("a short value is returned whole, got %q", got)
	}
}

func TestRequirePositiveTimeout(t *testing.T) {
	if _, failed := runCLI(t, func() { cli.RequirePositiveTimeout(-5) }); !strings.Contains(failed, "can't be negative") {
		t.Errorf("a negative timeout should be rejected, got %q", failed)
	}
	if _, failed := runCLI(t, func() { cli.RequirePositiveTimeout(0) }); failed != "" {
		t.Errorf("zero means the default, got %q", failed)
	}
}

func TestInstanceUpdateRefusesAVersionlessAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusAccepted)
		fmt.Fprint(writer, `{}`)
	}))
	defer server.Close()

	client := cli.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL})
	_, failed := runCLI(t, func() { cli.InstanceUpdate(client, true, 0) })
	if !strings.Contains(failed, "didn't say which version") {
		t.Errorf("an answer with no version must not report success against a dead instance, got %q", failed)
	}
}
