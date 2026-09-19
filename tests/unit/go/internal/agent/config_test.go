package agent_test

import (
	"testing"

	"github.com/orochibraru/homerun/internal/agent"
)

func TestLoadConfigDefaults(t *testing.T) {
	for _, key := range []string{"DOCKER_SOCKET_PATH", "AGENT_TOKEN", "PORT", "AGENT_SHUTDOWN_TIMEOUT", "AGENT_TOKEN_FILE"} {
		t.Setenv(key, "")
	}
	t.Setenv("HOME", "/home/someone")

	config := agent.LoadConfig()
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

	config := agent.LoadConfig()
	want := agent.Config{
		DockerSocketPath: "/custom.sock", ExplicitToken: "tok", Port: 9000,
		ShutdownTimeoutSeconds: 5, TokenFile: "/etc/agent-token",
	}
	if config != want {
		t.Errorf("want %+v, got %+v", want, config)
	}

	t.Setenv("PORT", "not-a-number")
	if agent.LoadConfig().Port != 7420 {
		t.Error("an unparseable port falls back to the default")
	}
}

func TestHomeDirFallbacks(t *testing.T) {
	t.Setenv("HOME", "")
	t.Setenv("USERPROFILE", "/users/win")
	if got := agent.HomeDir(); got != "/users/win" {
		t.Errorf("got %q", got)
	}
	t.Setenv("USERPROFILE", "")
	if got := agent.HomeDir(); got != "/root" {
		t.Errorf("got %q", got)
	}
}
