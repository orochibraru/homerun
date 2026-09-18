package release

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func serve(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	oldAPI, oldDownload := APIBase, DownloadBase
	APIBase, DownloadBase = server.URL, server.URL
	t.Cleanup(func() { APIBase, DownloadBase = oldAPI, oldDownload })
	return server
}

func unreachableURL(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.NotFoundHandler())
	url := server.URL
	server.Close()
	return url
}

func gzipped(t *testing.T, payload []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	if _, err := writer.Write(payload); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

func assertEmptyDir(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("failed download left %d file(s) behind in %s, first %q", len(entries), dir, entries[0].Name())
	}
}

func TestArch(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64"} {
		got, err := Arch(arch)
		if err != nil || got != arch {
			t.Errorf("Arch(%q) = %q, %v; want %q, nil", arch, got, err, arch)
		}
	}
	for _, arch := range []string{"386", "arm", "riscv64", ""} {
		if got, err := Arch(arch); err == nil {
			t.Errorf("Arch(%q) = %q, nil; want an error", arch, got)
		}
	}
}

func TestAssetSuffix(t *testing.T) {
	tests := []struct {
		goos, goarch, want string
		wantErr            bool
	}{
		{"linux", "amd64", "amd64", false},
		{"linux", "arm64", "arm64", false},
		{"darwin", "amd64", "darwin-amd64", false},
		{"darwin", "arm64", "darwin-arm64", false},
		{"windows", "amd64", "", true},
		{"freebsd", "arm64", "", true},
		{"linux", "386", "", true},
		{"darwin", "riscv64", "", true},
		{"windows", "386", "", true},
	}
	for _, tt := range tests {
		got, err := AssetSuffix(tt.goos, tt.goarch)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("AssetSuffix(%q, %q) = %q, %v; want %q, error=%v", tt.goos, tt.goarch, got, err, tt.want, tt.wantErr)
		}
	}
}

func TestAssetURL(t *testing.T) {
	if got, want := AssetURL("latest", "homerun-cli-amd64.gz"),
		"https://github.com/orochibraru/homerun/releases/latest/download/homerun-cli-amd64.gz"; got != want {
		t.Errorf("latest AssetURL = %q, want %q", got, want)
	}
	if got, want := AssetURL("v1.2.3", "homerun-cli-arm64.gz"),
		"https://github.com/orochibraru/homerun/releases/download/v1.2.3/homerun-cli-arm64.gz"; got != want {
		t.Errorf("pinned AssetURL = %q, want %q", got, want)
	}
}

func TestImageRef(t *testing.T) {
	if got, want := ImageRef("v1.2.3"), "docker.io/orochibraru/homerun:v1.2.3"; got != want {
		t.Errorf("ImageRef = %q, want %q", got, want)
	}
}

func TestLatestTag(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		var path string
		server := serve(t, func(w http.ResponseWriter, r *http.Request) {
			path = r.URL.Path
			_, _ = w.Write([]byte(`{"tag_name":"v9.8.7","name":"ignored"}`))
		})
		got, err := LatestTag(server.Client())
		if err != nil || got != "v9.8.7" {
			t.Fatalf("LatestTag = %q, %v; want v9.8.7, nil", got, err)
		}
		if path != "/repos/orochibraru/homerun/releases/latest" {
			t.Errorf("LatestTag requested %q", path)
		}
	})
	t.Run("non-2xx", func(t *testing.T) {
		server := serve(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		})
		_, err := LatestTag(server.Client())
		if err == nil || !strings.Contains(err.Error(), "403 Forbidden") {
			t.Fatalf("LatestTag error = %v, want one mentioning 403 Forbidden", err)
		}
	})
	t.Run("malformed body", func(t *testing.T) {
		server := serve(t, func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("<html>"))
		})
		_, err := LatestTag(server.Client())
		if err == nil || !strings.Contains(err.Error(), "Couldn't read the latest release") {
			t.Fatalf("LatestTag error = %v, want a read error", err)
		}
	})
	t.Run("unreachable", func(t *testing.T) {
		old := APIBase
		APIBase = unreachableURL(t)
		t.Cleanup(func() { APIBase = old })
		_, err := LatestTag(http.DefaultClient)
		if err == nil || !strings.Contains(err.Error(), "Couldn't check for updates") {
			t.Fatalf("LatestTag error = %v, want a connection error", err)
		}
	})
}

func TestDownloadGzipped(t *testing.T) {
	payload := []byte("#!/bin/sh\necho homerun\n")
	t.Run("ok", func(t *testing.T) {
		body := gzipped(t, payload)
		server := serve(t, func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write(body)
		})
		dir := t.TempDir()
		path, err := DownloadGzipped(server.Client(), AssetURL("v1.0.0", "homerun-cli-amd64.gz"), dir)
		if err != nil {
			t.Fatalf("DownloadGzipped: %v", err)
		}
		if filepath.Dir(path) != filepath.Clean(dir) {
			t.Errorf("staged file %q is not inside %q", path, dir)
		}
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, payload) {
			t.Errorf("staged content = %q, %v; want %q", got, err, payload)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		if info.Mode().Perm() != 0o755 {
			t.Errorf("staged mode = %v, want 0755", info.Mode().Perm())
		}
	})
	truncated := gzipped(t, bytes.Repeat(payload, 100))
	truncated = truncated[:len(truncated)/2]
	failures := []struct {
		name    string
		handler http.HandlerFunc
		want    string
	}{
		{"404", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) }, "404 Not Found"},
		{"not gzip", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("plain text, no gzip header")) }, "Download failed"},
		{"truncated gzip", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(truncated) }, "Download failed"},
	}
	for _, tt := range failures {
		t.Run(tt.name, func(t *testing.T) {
			server := serve(t, tt.handler)
			dir := t.TempDir()
			path, err := DownloadGzipped(server.Client(), server.URL+"/asset.gz", dir)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("DownloadGzipped = %q, %v; want error containing %q", path, err, tt.want)
			}
			assertEmptyDir(t, dir)
		})
	}
	t.Run("unreachable", func(t *testing.T) {
		dir := t.TempDir()
		_, err := DownloadGzipped(http.DefaultClient, unreachableURL(t)+"/asset.gz", dir)
		if err == nil || !strings.Contains(err.Error(), "Download failed") {
			t.Fatalf("DownloadGzipped error = %v, want a connection error", err)
		}
		assertEmptyDir(t, dir)
	})
}

func TestDownloadGzippedFallsBackToTempDir(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	body := gzipped(t, []byte("bin"))
	server := serve(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) })
	path, err := DownloadGzipped(server.Client(), server.URL+"/a.gz", filepath.Join(tmp, "missing"))
	if err != nil {
		t.Fatalf("DownloadGzipped into a missing dir: %v", err)
	}
	if filepath.Dir(path) != filepath.Clean(tmp) {
		t.Errorf("fallback staged %q, want it in TMPDIR %q", path, tmp)
	}
}
