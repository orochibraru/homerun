package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfigDefaults(t *testing.T) {
	for _, key := range []string{"DOCKER_SOCKET_PATH", "AGENT_TOKEN", "PORT", "AGENT_SHUTDOWN_TIMEOUT", "AGENT_TOKEN_FILE"} {
		t.Setenv(key, "")
	}
	t.Setenv("HOME", "/home/someone")

	config := loadConfig()
	if config.Port != 7420 {
		t.Errorf("default port is 7420, got %d", config.Port)
	}
	if config.ShutdownTimeoutSeconds != 120 {
		t.Errorf("default shutdown wait is 120s, got %d", config.ShutdownTimeoutSeconds)
	}
	if config.TokenFile != "/home/someone/.homerun-agent/token" {
		t.Errorf("the token lives under the user's home by default, got %q", config.TokenFile)
	}
	if config.ExplicitToken != "" || config.DockerSocketPath != "" {
		t.Errorf("nothing explicit was set, got %+v", config)
	}
}

func TestLoadConfigFromEnv(t *testing.T) {
	t.Setenv("DOCKER_SOCKET_PATH", "/custom.sock")
	t.Setenv("AGENT_TOKEN", "tok")
	t.Setenv("PORT", "9000")
	t.Setenv("AGENT_SHUTDOWN_TIMEOUT", "5")
	t.Setenv("AGENT_TOKEN_FILE", "/etc/agent-token")

	config := loadConfig()
	want := Config{
		DockerSocketPath: "/custom.sock", ExplicitToken: "tok", Port: 9000,
		ShutdownTimeoutSeconds: 5, TokenFile: "/etc/agent-token",
	}
	if config != want {
		t.Errorf("want %+v, got %+v", want, config)
	}

	t.Setenv("PORT", "not-a-number")
	if loadConfig().Port != 7420 {
		t.Error("an unparseable port falls back to the default")
	}
}

func TestHomeDirFallbacks(t *testing.T) {
	t.Setenv("HOME", "")
	t.Setenv("USERPROFILE", "/users/win")
	if got := homeDir(); got != "/users/win" {
		t.Errorf("got %q", got)
	}
	t.Setenv("USERPROFILE", "")
	if got := homeDir(); got != "/root" {
		t.Errorf("got %q", got)
	}
}

func stubContextHost(t *testing.T, host string) {
	t.Helper()
	original := dockerContextHost
	dockerContextHost = func() string { return host }
	t.Cleanup(func() { dockerContextHost = original })
}

func TestDetectDockerSocketPath(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix:///from/docker-host.sock")
	stubContextHost(t, "unix:///from/context.sock")
	if got := detectDockerSocketPath(); got != "/from/docker-host.sock" {
		t.Errorf("DOCKER_HOST wins, got %q", got)
	}

	t.Setenv("DOCKER_HOST", "tcp://remote:2375")
	if got := detectDockerSocketPath(); got != "/from/context.sock" {
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
	got := detectDockerSocketPath()
	if got != socket && got != "/var/run/docker.sock" {
		t.Errorf("without docker, a known socket location is found, got %q", got)
	}

	if err := os.Remove(socket); err != nil {
		t.Fatal(err)
	}
	if got := detectDockerSocketPath(); got != "/var/run/docker.sock" {
		if _, err := os.Stat(got); err != nil {
			t.Errorf("with nothing found, the conventional default is used, got %q", got)
		}
	}
}
