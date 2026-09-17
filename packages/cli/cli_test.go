package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveConfigPrefersFlagsThenEnvThenStore(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("HOMERUN_BASE_URL", "")
	t.Setenv("HOMERUN_API_KEY", "")

	if config := resolveConfig("", ""); config != nil {
		t.Fatalf("expected nil without any source, got %+v", config)
	}

	t.Setenv("HOMERUN_BASE_URL", "https://env.example.com")
	t.Setenv("HOMERUN_API_KEY", "env-key")
	config := resolveConfig("", "")
	if config == nil || config.BaseURL != "https://env.example.com" || config.APIKey != "env-key" {
		t.Fatalf("env vars not used: %+v", config)
	}

	config = resolveConfig("https://flag.example.com/", "flag-key")
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

	if stored := readStoredConfig(); stored != nil {
		t.Fatalf("expected no config in a fresh home, got %+v", stored)
	}
	if err := writeStoredConfig(StoredConfig{APIKey: "k", BaseURL: "https://example.com"}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	stored := readStoredConfig()
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

	clearStoredConfig()
	if stored := readStoredConfig(); stored != nil {
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
		if stored := readStoredConfig(); stored != nil {
			t.Errorf("%s: expected nil, got %+v", name, stored)
		}
	}
}

func TestAPIErrorMessage(t *testing.T) {
	if got := apiErrorMessage(422, []byte(`{"error":"bad"}`)); got != `422 Unprocessable Entity: {"error":"bad"}` {
		t.Errorf("JSON body should be kept verbatim, got %q", got)
	}

	got := apiErrorMessage(404, []byte("<html>nope</html>"))
	if !strings.Contains(got, "probably older than this CLI") {
		t.Errorf("a non-JSON 404 should blame the instance's age, got %q", got)
	}

	got = apiErrorMessage(500, []byte("<html>boom</html>"))
	if !strings.Contains(got, "non-JSON body") {
		t.Errorf("a non-JSON error should say so, got %q", got)
	}
}

func TestFindingsAtOrAboveCountsDownToTheLevel(t *testing.T) {
	counts := SeverityCounts{Critical: 1, High: 2, Medium: 4, Low: 8, Unknown: 16}

	for level, want := range map[string]int{
		"critical": 1,
		"high":     3,
		"medium":   7,
		"low":      15,
	} {
		if got := findingsAtOrAbove(counts, level); got != want {
			t.Errorf("--fail-on %s: want %d, got %d", level, want, got)
		}
	}
}

func TestRevisionRowMarkersAndShortening(t *testing.T) {
	row := revisionRow(Revision{
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

	row = revisionRow(Revision{Previous: true, Retained: false})
	if row["marker"] != "previous (not retained)" {
		t.Errorf("a dropped image should say so, got %q", row["marker"])
	}
	row = revisionRow(Revision{Retained: false})
	if row["marker"] != "(not retained)" {
		t.Errorf("an unmarked revision keeps only the retention note, got %q", row["marker"])
	}
}

func TestInstanceStatusText(t *testing.T) {
	unreachable := instanceStatusText(InstanceUpdateStatus{Current: "1.0.0"})
	if !strings.Contains(unreachable, "unknown (couldn't reach GitHub)") {
		t.Errorf("no latest release should say so, got %q", unreachable)
	}

	status := InstanceUpdateStatus{Current: "1.0.0", UpdateAvailable: true}
	status.Latest = &struct {
		Version string `json:"version"`
	}{Version: "1.1.0"}
	status.Preflight.Ready = true
	if !strings.Contains(instanceStatusText(status), "run `homerun instance update`") {
		t.Errorf("a ready update should point at the command, got %q", instanceStatusText(status))
	}

	status.Preflight.Ready = false
	status.Preflight.Reason = "a deploy is running"
	if !strings.Contains(instanceStatusText(status), "a deploy is running") {
		t.Errorf("a blocked update should carry the reason, got %q", instanceStatusText(status))
	}

	status.Preflight.Reason = ""
	if !strings.Contains(instanceStatusText(status), "unknown reason") {
		t.Errorf("a blocked update with no reason still explains itself, got %q", instanceStatusText(status))
	}
}

func TestPrintPageFooterOnlyWhenTruncated(t *testing.T) {
	header := http.Header{}
	header.Set("x-total-count", "10")
	header.Set("x-page", "1")
	header.Set("x-per-page", "4")

	if got := captureStdout(t, func() { printPageFooter(header, 4) }); !strings.Contains(got, "page 1 of 3") {
		t.Errorf("a truncated page should say how much is left, got %q", got)
	}
	if got := captureStdout(t, func() { printPageFooter(header, 10) }); got != "" {
		t.Errorf("a complete listing needs no footer, got %q", got)
	}
	if got := captureStdout(t, func() { printPageFooter(http.Header{}, 4) }); got != "" {
		t.Errorf("no pagination headers means no footer, got %q", got)
	}
}

func TestPrintTable(t *testing.T) {
	out := captureStdout(t, func() {
		printTable([]map[string]string{{"id": "a", "name": "alpha"}, {"id": "bb"}}, []string{"id", "name"})
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

	if got := captureStdout(t, func() { printTable(nil, []string{"id"}) }); got != "(none)\n" {
		t.Errorf("an empty listing should say (none), got %q", got)
	}
}

func TestSplitGlobalFlagsAnywhereInTheArgs(t *testing.T) {
	global, rest := splitGlobalFlags([]string{
		"services", "list", "--base-url", "https://example.com", "--json", "--api-key=k",
	})
	if global.baseURL != "https://example.com" || global.apiKey != "k" {
		t.Errorf("globals should be picked up after the subcommand, got %+v", global)
	}
	if strings.Join(rest, " ") != "services list --json" {
		t.Errorf("everything else should keep its order, got %v", rest)
	}
}

func TestParseAcceptsFlagsAfterPositionals(t *testing.T) {
	set := newFlagSet("test")
	options := listFlags(set)
	positionals := parse(set, []string{"an-id", "--json", "--per-page", "5"})

	if strings.Join(positionals, ",") != "an-id" {
		t.Errorf("positionals lost: %v", positionals)
	}
	if !options.JSON || options.PerPage != 5 {
		t.Errorf("flags after a positional should still parse, got %+v", options)
	}
}

func TestListQuery(t *testing.T) {
	query := listQuery(ListArgs{Page: 2, PerPage: 50, Search: "web"})
	if query.Get("page") != "2" || query.Get("perPage") != "50" || query.Get("q") != "web" {
		t.Errorf("unexpected query %v", query)
	}
	if len(listQuery(ListArgs{})) != 0 {
		t.Errorf("unset options should send nothing, got %v", listQuery(ListArgs{}))
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
