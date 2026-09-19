package dockersocket_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/orochibraru/homerun/internal/dockersocket"
)

// stubContextHost makes dockersocket.ContextHost answer host for one test.
func stubContextHost(t *testing.T, host string) {
	t.Helper()
	original := dockersocket.ContextHost
	dockersocket.ContextHost = func() string { return host }
	t.Cleanup(func() { dockersocket.ContextHost = original })
}

func TestResolvePrefersExplicit(t *testing.T) {
	if got := dockersocket.Resolve("/explicit.sock"); got != "/explicit.sock" {
		t.Errorf("got %q", got)
	}
}

func TestDetect(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix:///from/docker-host.sock")
	stubContextHost(t, "unix:///from/context.sock")
	if got := dockersocket.Detect(); got != "/from/docker-host.sock" {
		t.Errorf("DOCKER_HOST wins, got %q", got)
	}

	t.Setenv("DOCKER_HOST", "tcp://remote:2375")
	if got := dockersocket.Detect(); got != "/from/context.sock" {
		t.Errorf("a non-unix DOCKER_HOST falls through to the docker context, got %q", got)
	}

	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DOCKER_HOST", "")
	stubContextHost(t, "")
	socket := filepath.Join(home, ".colima", "default", "docker.sock")
	if err := os.MkdirAll(filepath.Dir(socket), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(socket, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	got := dockersocket.Detect()
	if got != socket && got != "/var/run/docker.sock" {
		t.Errorf("without docker, a known socket location is found, got %q", got)
	}

	if err := os.Remove(socket); err != nil {
		t.Fatal(err)
	}
	if got := dockersocket.Detect(); got != "/var/run/docker.sock" {
		if _, err := os.Stat(got); err != nil {
			t.Errorf("with nothing found, the conventional default is used, got %q", got)
		}
	}
}
