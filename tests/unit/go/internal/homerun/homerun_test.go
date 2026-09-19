package homerun_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/homerun"
)

// scratchHome points HOME at a fresh temp directory and clears the
// HOMERUN_BASE_URL/HOMERUN_API_KEY env vars for one test.
func scratchHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("HOMERUN_BASE_URL", "")
	t.Setenv("HOMERUN_API_KEY", "")
	return home
}

// writeRaw writes body verbatim to the stored config path.
func writeRaw(t *testing.T, body string) {
	t.Helper()
	if err := os.MkdirAll(homerun.ConfigDir(), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(homerun.ConfigPath(), []byte(body), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestConfigPaths(t *testing.T) {
	home := scratchHome(t)
	if got, want := homerun.ConfigDir(), filepath.Join(home, ".config", "homerun"); got != want {
		t.Errorf("homerun.ConfigDir = %q, want %q", got, want)
	}
	if got, want := homerun.ConfigPath(), filepath.Join(home, ".config", "homerun", "config.json"); got != want {
		t.Errorf("homerun.ConfigPath = %q, want %q", got, want)
	}
}

func TestReadStoredConfigInvalid(t *testing.T) {
	scratchHome(t)
	if got := homerun.ReadStoredConfig(); got != nil {
		t.Errorf("missing file: homerun.ReadStoredConfig = %+v, want nil", got)
	}
	for name, body := range map[string]string{
		"junk":          "not json {",
		"missing key":   `{"baseUrl":"https://h.example"}`,
		"missing url":   `{"apiKey":"k"}`,
		"empty strings": `{"apiKey":"","baseUrl":""}`,
	} {
		writeRaw(t, body)
		if got := homerun.ReadStoredConfig(); got != nil {
			t.Errorf("%s: homerun.ReadStoredConfig = %+v, want nil", name, got)
		}
	}
}

func TestStoredConfigRoundTrip(t *testing.T) {
	scratchHome(t)
	want := homerun.StoredConfig{APIKey: "key-1", BaseURL: "https://h.example"}
	if err := homerun.WriteStoredConfig(want); err != nil {
		t.Fatalf("homerun.WriteStoredConfig: %v", err)
	}
	got := homerun.ReadStoredConfig()
	if got == nil || *got != want {
		t.Fatalf("homerun.ReadStoredConfig = %+v, want %+v", got, want)
	}
	info, err := os.Stat(homerun.ConfigPath())
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("config file mode = %v, want 0600", info.Mode().Perm())
	}
	homerun.ClearStoredConfig()
	if _, err := os.Stat(homerun.ConfigPath()); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("after homerun.ClearStoredConfig, stat = %v, want not-exist", err)
	}
	homerun.ClearStoredConfig()
}

func TestResolveConfig(t *testing.T) {
	tests := []struct {
		name             string
		stored           *homerun.StoredConfig
		envURL, envKey   string
		flagURL, flagKey string
		wantURL, wantKey string
		wantNil          bool
	}{
		{name: "nothing", wantNil: true},
		{name: "stored only", stored: &homerun.StoredConfig{APIKey: "sk", BaseURL: "https://stored/"}, wantURL: "https://stored", wantKey: "sk"},
		{name: "env beats stored", stored: &homerun.StoredConfig{APIKey: "sk", BaseURL: "https://stored"}, envURL: "https://env//", envKey: "ek", wantURL: "https://env", wantKey: "ek"},
		{name: "flags beat env", stored: &homerun.StoredConfig{APIKey: "sk", BaseURL: "https://stored"}, envURL: "https://env", envKey: "ek", flagURL: "https://flag/", flagKey: "fk", wantURL: "https://flag", wantKey: "fk"},
		{name: "flag url, stored key", stored: &homerun.StoredConfig{APIKey: "sk", BaseURL: "https://stored"}, flagURL: "https://flag", wantURL: "https://flag", wantKey: "sk"},
		{name: "env key, stored url", stored: &homerun.StoredConfig{APIKey: "sk", BaseURL: "https://stored"}, envKey: "ek", wantURL: "https://stored", wantKey: "ek"},
		{name: "url only", flagURL: "https://flag", wantNil: true},
		{name: "key only", envKey: "ek", wantNil: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scratchHome(t)
			t.Setenv("HOMERUN_BASE_URL", tt.envURL)
			t.Setenv("HOMERUN_API_KEY", tt.envKey)
			if tt.stored != nil {
				if err := homerun.WriteStoredConfig(*tt.stored); err != nil {
					t.Fatalf("homerun.WriteStoredConfig: %v", err)
				}
			}
			got := homerun.ResolveConfig(tt.flagURL, tt.flagKey)
			if tt.wantNil {
				if got != nil {
					t.Fatalf("homerun.ResolveConfig = %+v, want nil", got)
				}
				return
			}
			if got == nil || got.BaseURL != tt.wantURL || got.APIKey != tt.wantKey {
				t.Fatalf("homerun.ResolveConfig = %+v, want {APIKey:%s BaseURL:%s}", got, tt.wantKey, tt.wantURL)
			}
		})
	}
}

type recorded struct {
	method, path, rawQuery, apiKey string
}

// newServer starts an httptest server that always answers status/body and
// records the last request it saw.
func newServer(t *testing.T, status int, body string) (*httptest.Server, *recorded) {
	t.Helper()
	seen := &recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = recorded{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Get("x-api-key")}
		w.Header().Set("X-Test", "yes")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, seen
}

func TestSend(t *testing.T) {
	server, seen := newServer(t, http.StatusTeapot, "")
	client := homerun.NewClient(homerun.Config{APIKey: "secret", BaseURL: server.URL + "/"})
	response, err := client.Send(http.MethodDelete, "/services/abc", url.Values{"force": {"1"}, "q": {"a b"}})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusTeapot {
		t.Errorf("Send status = %d, want the raw 418", response.StatusCode)
	}
	want := recorded{http.MethodDelete, "/api/v1/services/abc", "force=1&q=a+b", "secret"}
	if *seen != want {
		t.Errorf("server saw %+v, want %+v", *seen, want)
	}

	response, err = client.Send(http.MethodGet, "/me", nil)
	if err != nil {
		t.Fatalf("Send without query: %v", err)
	}
	_ = response.Body.Close()
	if seen.rawQuery != "" || seen.path != "/api/v1/me" {
		t.Errorf("no-query Send hit %q?%q", seen.path, seen.rawQuery)
	}
}

func TestSendBadURL(t *testing.T) {
	client := homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: "http://bad host"})
	if _, err := client.Send(http.MethodGet, "/x", nil); err == nil {
		t.Error("Send with an unparseable base URL succeeded, want an error")
	}
}

func TestDo(t *testing.T) {
	server, _ := newServer(t, http.StatusOK, `{"ok":true}`)
	body, header, err := homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL}).Do(http.MethodGet, "/x", nil)
	if err != nil || string(body) != `{"ok":true}` || header.Get("X-Test") != "yes" {
		t.Fatalf("Do = %q, %v, %v", body, header, err)
	}

	server, _ = newServer(t, http.StatusBadRequest, `{"error":"nope"}`)
	body, header, err = homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL}).Do(http.MethodPost, "/x", nil)
	var apiErr *homerun.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("Do on 400 error = %v, want *homerun.APIError", err)
	}
	if apiErr.Status != http.StatusBadRequest || string(apiErr.Body) != `{"error":"nope"}` {
		t.Errorf("homerun.APIError = %d %q", apiErr.Status, apiErr.Body)
	}
	if string(body) != `{"error":"nope"}` || header.Get("X-Test") != "yes" {
		t.Errorf("Do on 400 should still return body and header, got %q %v", body, header)
	}
	if !strings.Contains(err.Error(), `400 Bad Request: {"error":"nope"}`) {
		t.Errorf("homerun.APIError.Error() = %q", err.Error())
	}

	unreachable := httptest.NewServer(http.NotFoundHandler())
	unreachable.Close()
	if _, _, err := homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: unreachable.URL}).Do(http.MethodGet, "/x", nil); err == nil {
		t.Error("Do against a closed server succeeded")
	}
}

func TestDecode(t *testing.T) {
	server, _ := newServer(t, http.StatusOK, `{"name":"svc"}`)
	client := homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL})
	var out struct{ Name string }
	header, err := client.Decode(http.MethodGet, "/x", nil, &out)
	if err != nil || out.Name != "svc" || header.Get("X-Test") != "yes" {
		t.Fatalf("Decode = %+v, %v, %v", out, header, err)
	}
	if _, err := client.Decode(http.MethodGet, "/x", nil, nil); err != nil {
		t.Errorf("Decode into nil = %v, want nil", err)
	}

	server, _ = newServer(t, http.StatusOK, `not json`)
	_, err = homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL}).Decode(http.MethodGet, "/x", nil, &out)
	if err == nil || !strings.Contains(err.Error(), "couldn't read the instance's answer") {
		t.Errorf("Decode of a bad body = %v, want a read error", err)
	}

	server, _ = newServer(t, http.StatusInternalServerError, `{"error":"boom"}`)
	_, err = homerun.NewClient(homerun.Config{APIKey: "k", BaseURL: server.URL}).Decode(http.MethodGet, "/x", nil, &out)
	var apiErr *homerun.APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusInternalServerError {
		t.Errorf("Decode on 500 = %v, want *homerun.APIError 500", err)
	}
}

func TestAPIErrorMessage(t *testing.T) {
	if got, want := homerun.APIErrorMessage(http.StatusConflict, []byte(" {\"error\":\"taken\"}\n")), `409 Conflict: {"error":"taken"}`; got != want {
		t.Errorf("JSON body: %q, want %q", got, want)
	}
	got := homerun.APIErrorMessage(http.StatusNotFound, []byte("<html>404</html>"))
	if !strings.HasPrefix(got, "404 Not Found: ") || !strings.Contains(got, "older than this CLI") || !strings.Contains(got, "v"+buildinfo.Version) {
		t.Errorf("non-JSON 404: %q", got)
	}
	if got, want := homerun.APIErrorMessage(http.StatusBadGateway, []byte("<html>")), "502 Bad Gateway: the instance answered with a non-JSON body."; got != want {
		t.Errorf("non-JSON 502: %q, want %q", got, want)
	}
	if got := homerun.APIErrorMessage(http.StatusBadGateway, nil); !strings.Contains(got, "non-JSON body") {
		t.Errorf("empty 502: %q", got)
	}
}

func TestConfigDirWithoutHome(t *testing.T) {
	t.Setenv("HOME", "")
	if got, want := homerun.ConfigDir(), filepath.Join(".config", "homerun"); got != want {
		t.Errorf("homerun.ConfigDir without HOME = %q, want %q", got, want)
	}
}

func TestWriteStoredConfigUnwritable(t *testing.T) {
	home := scratchHome(t)
	if err := os.WriteFile(filepath.Join(home, ".config"), nil, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := homerun.WriteStoredConfig(homerun.StoredConfig{APIKey: "k", BaseURL: "u"}); err == nil {
		t.Error("homerun.WriteStoredConfig with ~/.config as a file succeeded, want an error")
	}
}
