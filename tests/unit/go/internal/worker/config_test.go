package worker_test

import (
	"io"
	"os"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/httpapi"
	"github.com/orochibraru/homerun/internal/worker"
)

// clearWorkerEnv unsets every variable LoadConfig reads, so a test starts from
// the defaults whatever the machine running it exports.
func clearWorkerEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"DATABASE_URL", "WORKER_PORT", "WORKER_TOKEN", "WORKER_TOKEN_FILE",
		"WORKER_CONCURRENCY", "WORKER_ID", "DOCKER_SOCKET_PATH",
	} {
		t.Setenv(key, "")
	}
}

func TestNoDatabaseMeansAgentModeOnThePortRemoteHostsAlreadyUse(t *testing.T) {
	clearWorkerEnv(t)
	t.Setenv("HOME", "/home/someone")

	config := worker.LoadConfig()
	if !config.AgentMode() {
		t.Fatal("with no DATABASE_URL there's no job table, so this is a build host")
	}
	if config.Port != 7420 {
		t.Errorf("agent mode keeps 7420, what registered remote hosts point at, got %d", config.Port)
	}
	if config.TokenFile != "/home/someone/.homerun-worker/token" {
		t.Errorf("the generated token lives under the user's home, got %q", config.TokenFile)
	}
}

func TestWithADatabaseTheWorkerRunsNextToTheApp(t *testing.T) {
	clearWorkerEnv(t)
	t.Setenv("DATABASE_URL", "postgres://x")

	config := worker.LoadConfig()
	if config.AgentMode() {
		t.Fatal("a worker with a job table isn't a build host")
	}
	if config.Port != 7430 {
		t.Errorf("next to the app the control API is on 7430, got %d", config.Port)
	}
}

func TestExplicitSettingsWin(t *testing.T) {
	clearWorkerEnv(t)
	t.Setenv("WORKER_PORT", "9000")
	t.Setenv("WORKER_TOKEN", "tok")
	t.Setenv("WORKER_TOKEN_FILE", "/etc/worker-token")

	config := worker.LoadConfig()
	if config.Port != 9000 || config.ExplicitToken != "tok" || config.TokenFile != "/etc/worker-token" {
		t.Errorf("explicit values must win, got %+v", config)
	}

	t.Setenv("WORKER_PORT", "not-a-number")
	if worker.LoadConfig().Port != 7420 {
		t.Error("an unparseable port falls back to the mode's default")
	}
}

func TestAgentBannerShowsAGeneratedTokenButNotAnEnvOne(t *testing.T) {
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = write
	config := worker.Config{DockerSocketPath: "/sock", Port: 7420, TokenFile: "/t"}
	worker.PrintAgentBanner(config, "tok", httpapi.TokenGenerated)
	worker.PrintAgentBanner(config, "tok", httpapi.TokenPersisted)
	worker.PrintAgentBanner(config, "hidden", httpapi.TokenFromEnv)
	_ = write.Close()
	os.Stdout = original
	raw, _ := io.ReadAll(read)
	out := string(raw)
	for _, fragment := range []string{"agent mode", "generated just now (/t)", "persisted (/t)", "WORKER_TOKEN env var", "Token:          tok"} {
		if !strings.Contains(out, fragment) {
			t.Errorf("the banner should mention %q:\n%s", fragment, out)
		}
	}
	if strings.Contains(out, "hidden") {
		t.Error("an env token isn't echoed back, whoever set it already has it")
	}
}
